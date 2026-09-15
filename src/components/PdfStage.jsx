import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export default function PdfStage({
  template,
  fields,
  onFieldsChange,
  tool,
  selectedId,
  onSelect,
  readOnly = false,
}) {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderRef = useRef(null);
  const dragRef = useRef(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });
  const [status, setStatus] = useState("loading");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const update = () => setWidth(Math.max(280, Math.min(shell.clientWidth - 24, 900)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task = null;
    const controller = new AbortController();
    setStatus("loading");

    Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      fetch(`/api/templates/${template.id}/file`, {
        credentials: "same-origin",
        signal: controller.signal,
      }),
    ])
      .then(async ([pdfjs, response]) => {
        if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`);
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return null;
        task = pdfjs.getDocument({ data });
        return task.promise;
      })
      .then((pdf) => {
        if (!pdf) return undefined;
        if (cancelled) return pdf.destroy();
        pdfRef.current = pdf;
        setPageIndex((current) => Math.min(current, pdf.numPages - 1));
        setStatus("ready");
        return undefined;
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") return;
        console.error("Impossible de charger l’aperçu PDF.", error);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      controller.abort();
      renderRef.current?.cancel();
      task?.destroy();
      pdfRef.current = null;
    };
  }, [template.id, retryKey]);

  useEffect(() => {
    if (status !== "ready" || !pdfRef.current || !canvasRef.current || !width) return undefined;
    let cancelled = false;
    renderRef.current?.cancel();
    pdfRef.current
      .getPage(pageIndex + 1)
      .then((page) => {
        if (cancelled) return;
        const initial = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / initial.width });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setPageSize({ width: viewport.width, height: viewport.height });
        const job = page.render({
          canvasContext: context,
          canvas,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        renderRef.current = job;
        return job.promise;
      })
      .catch((error) => {
        if (cancelled || error?.name === "RenderingCancelledException") return;
        console.error("Impossible d’afficher la page du PDF.", error);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      renderRef.current?.cancel();
    };
  }, [pageIndex, status, width]);

  const pageFields = fields.filter((field) => field.page === pageIndex);

  function addField(event) {
    if (readOnly || !tool || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fieldWidth = tool === "signature" ? 0.42 : 0.36;
    const fieldHeight = tool === "signature" ? 0.12 : 0.06;
    const x = Math.max(0, Math.min(1 - fieldWidth, (event.clientX - bounds.left) / bounds.width - fieldWidth / 2));
    const y = Math.max(0, Math.min(1 - fieldHeight, (event.clientY - bounds.top) / bounds.height - fieldHeight / 2));
    const count = fields.filter((field) => field.type === tool).length + 1;
    const field = {
      id: crypto.randomUUID(),
      type: tool,
      label: tool === "signature" ? "Votre signature" : `Champ texte ${count}`,
      page: pageIndex,
      x,
      y,
      width: fieldWidth,
      height: fieldHeight,
      required: true,
    };
    onFieldsChange([...fields, field]);
    onSelect(field.id);
  }

  function startDrag(event, field, mode) {
    if (readOnly) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: field.id,
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      field: { ...field },
    };
    onSelect(field.id);
  }

  function moveDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = (event.clientX - drag.startX) / pageSize.width;
    const dy = (event.clientY - drag.startY) / pageSize.height;
    onFieldsChange(
      fields.map((field) => {
        if (field.id !== drag.id) return field;
        if (drag.mode === "move") {
          return {
            ...field,
            x: Math.max(0, Math.min(1 - drag.field.width, drag.field.x + dx)),
            y: Math.max(0, Math.min(1 - drag.field.height, drag.field.y + dy)),
          };
        }
        return {
          ...field,
          width: Math.max(0.08, Math.min(1 - drag.field.x, drag.field.width + dx)),
          height: Math.max(0.04, Math.min(1 - drag.field.y, drag.field.height + dy)),
        };
      }),
    );
  }

  function endDrag(event) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  return (
    <div className="pdf-stage" ref={shellRef}>
      <div className="page-nav" aria-label="Navigation du PDF">
        <button type="button" onClick={() => setPageIndex((value) => Math.max(0, value - 1))} disabled={pageIndex === 0}>
          Précédente
        </button>
        <span>Page {pageIndex + 1} sur {template.pageCount}</span>
        <button type="button" onClick={() => setPageIndex((value) => Math.min(template.pageCount - 1, value + 1))} disabled={pageIndex >= template.pageCount - 1}>
          Suivante
        </button>
      </div>

      <div className="pdf-sheet" style={{ width: pageSize.width, height: pageSize.height }}>
        <canvas ref={canvasRef} aria-label={`Aperçu de la page ${pageIndex + 1}`} />
        <div className={`field-layer ${tool && !readOnly ? "is-placing" : ""}`} onPointerDown={addField}>
          {pageFields.map((field) => (
            <div
              key={field.id}
              className={`placed-field ${field.type === "signature" ? "signature-field" : ""} ${selectedId === field.id ? "selected" : ""}`}
              style={{
                left: `${field.x * 100}%`,
                top: `${field.y * 100}%`,
                width: `${field.width * 100}%`,
                height: `${field.height * 100}%`,
              }}
              onPointerDown={(event) => startDrag(event, field, "move")}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span>{field.type === "signature" ? "Signature" : field.label}</span>
              {!readOnly && (
                <i
                  className="resize-handle"
                  aria-hidden="true"
                  onPointerDown={(event) => startDrag(event, field, "resize")}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              )}
            </div>
          ))}
        </div>
        {status === "loading" && <div className="pdf-feedback">Chargement du PDF…</div>}
        {status === "error" && (
          <div className="pdf-feedback error">
            <span>L’aperçu ne peut pas être affiché.</span>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
              Réessayer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
