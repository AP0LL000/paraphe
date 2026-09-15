import { useEffect, useRef, useState } from "react";

export default function SignaturePad({ onChange, stepNumber, value }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const previousRef = useRef(null);
  const inkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const snapshot = inkRef.current ? canvas.toDataURL("image/png") : null;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.7;
      context.strokeStyle = "#142824";
      if (snapshot) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, bounds.width, bounds.height);
        image.src = snapshot;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");

    if (!value) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
      inkRef.current = false;
      setHasInk(false);
      return undefined;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const bounds = canvas.getBoundingClientRect();
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.drawImage(image, 0, 0, bounds.width, bounds.height);
      inkRef.current = true;
      setHasInk(true);
    };
    image.src = value;
    return () => {
      cancelled = true;
    };
  }, [value]);

  function point(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function start(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    previousRef.current = point(event);
  }

  function move(event) {
    if (!drawingRef.current || !previousRef.current) return;
    const next = point(event);
    const context = event.currentTarget.getContext("2d");
    context.beginPath();
    context.moveTo(previousRef.current.x, previousRef.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    previousRef.current = next;
    if (!inkRef.current) {
      inkRef.current = true;
      setHasInk(true);
    }
  }

  function end(event) {
    drawingRef.current = false;
    previousRef.current = null;
    onChange(inkRef.current ? event.currentTarget.toDataURL("image/png") : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
    }
    inkRef.current = false;
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="signature-panel">
      <div className="signature-title">
        <b className="signature-step-number">{String(stepNumber).padStart(2, "0")}</b>
        <div>
          <strong>Votre signature</strong>
          <p>Signez avec le doigt, une souris ou un stylet.</p>
        </div>
        <button type="button" onClick={clear} disabled={!hasInk}>Effacer</button>
      </div>
      <div className="signature-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="signature-canvas"
          aria-label="Zone de signature manuscrite"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        <span aria-hidden="true" />
      </div>
    </div>
  );
}
