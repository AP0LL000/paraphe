import { useEffect, useMemo, useState } from "react";
import PdfStage from "./components/PdfStage";
import SignaturePad from "./components/SignaturePad";

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(body.message || "Une erreur est survenue.");
  }
  return body;
}

function Icon({ name }) {
  const icons = {
    upload: "↥",
    text: "T",
    signature: "∿",
    mail: "✉",
    check: "✓",
    document: "▤",
    download: "↓",
    trash: "×",
  };
  return <span className={`icon icon-${name}`} aria-hidden="true">{icons[name]}</span>;
}

function WorkflowSteps({ mode }) {
  const activeIndex = {
    library: 0,
    upload: 0,
    prepare: 1,
    fill: 2,
    complete: 3,
  }[mode] ?? 0;
  const steps = [
    ["Documents", "Choisir"],
    ["Zones", "Préparer"],
    ["Formulaire", "Remplir"],
    ["Terminé", "Envoyer"],
  ];

  return (
    <nav className="workflow-steps" aria-label="Progression dans le parcours">
      <ol>
        {steps.map(([label, action], index) => (
          <li
            key={label}
            className={`${index === activeIndex ? "current" : ""} ${index < activeIndex ? "done" : ""}`}
            aria-current={index === activeIndex ? "step" : undefined}
          >
            <span>{index < activeIndex ? "✓" : index + 1}</span>
            <div><strong>{label}</strong><small>{action}</small></div>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function App() {
  const [templates, setTemplates] = useState([]);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [mode, setMode] = useState("library");
  const [fields, setFields] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState("text");
  const [values, setValues] = useState({});
  const [signature, setSignature] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/templates")
      .then(readResponse)
      .then((body) => {
        if (!mounted) return;
        setTemplates(body.templates || []);
        setEmailConfigured(Boolean(body.emailConfigured));
      })
      .catch((error) => mounted && showNotice(error.message, "error"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const selectedField = fields.find((field) => field.id === selectedId) || null;
  const orderedTextFields = useMemo(() => {
    if (!activeTemplate) return [];
    return activeTemplate.fields
      .filter((field) => field.type === "text")
      .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  }, [activeTemplate]);

  function showNotice(message, type = "success") {
    setNotice({ message, type });
  }

  function goToWorkspace() {
    document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openLibrary() {
    setMode("library");
    setActiveTemplate(null);
    setSelectedId(null);
    setNotice(null);
    goToWorkspace();
  }

  function openUpload() {
    setMode("upload");
    setNotice(null);
    goToWorkspace();
  }

  function openPrepare(template) {
    setActiveTemplate(template);
    setFields(template.fields || []);
    setSelectedId(null);
    setTool("text");
    setMode("prepare");
    setNotice(null);
    goToWorkspace();
  }

  function openFill(template) {
    if (!template.fields?.some((field) => field.type === "signature")) {
      openPrepare(template);
      showNotice("Ajoutez d’abord une zone de signature.", "error");
      return;
    }
    setActiveTemplate(template);
    setValues({});
    setSignature(null);
    setCompletion(null);
    setMode("fill");
    setNotice(null);
    goToWorkspace();
  }

  async function uploadTemplate(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setNotice(null);
    try {
      const body = await readResponse(
        await fetch("/api/templates", {
          method: "POST",
          body: new FormData(formElement),
        }),
      );
      setTemplates((current) => [body.template, ...current]);
      formElement.reset();
      setFileName("");
      openPrepare(body.template);
      showNotice("PDF enregistré. Placez maintenant les zones à remplir.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveFields() {
    if (!activeTemplate) return;
    setBusy(true);
    setNotice(null);
    try {
      const body = await readResponse(
        await fetch(`/api/templates/${activeTemplate.id}/fields`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        }),
      );
      setTemplates((current) =>
        current.map((template) => (template.id === body.template.id ? body.template : template)),
      );
      setActiveTemplate(body.template);
      setMode("library");
      showNotice("Le modèle est prêt. Ses zones seront réutilisées pour chaque nouvelle copie.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitCompleted(event) {
    event.preventDefault();
    if (!activeTemplate || !signature) {
      showNotice("Dessinez votre signature avant l’envoi.", "error");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const signatureBlob = await fetch(signature).then((response) => response.blob());
      const form = new FormData();
      form.set("values", JSON.stringify(values));
      form.set("signature", signatureBlob, "signature.png");
      const body = await readResponse(
        await fetch(`/api/templates/${activeTemplate.id}/complete`, {
          method: "POST",
          body: form,
        }),
      );
      setCompletion(body);
      setMode("complete");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function editCompletedForm() {
    setCompletion(null);
    setMode("fill");
    showNotice("Vous pouvez corriger les informations, puis générer une nouvelle version du PDF.");
    goToWorkspace();
  }

  function startNewCopy() {
    setValues({});
    setSignature(null);
    setCompletion(null);
    setMode("fill");
    setNotice(null);
    goToWorkspace();
  }

  function editSavedZones() {
    if (activeTemplate) openPrepare(activeTemplate);
  }

  async function removeTemplate(template) {
    if (!window.confirm(`Supprimer le modèle « ${template.title} » et ses documents générés ?`)) return;
    try {
      await readResponse(await fetch(`/api/templates/${template.id}`, { method: "DELETE" }));
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      showNotice("Le modèle et ses copies ont été supprimés.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  }

  function patchSelected(patch) {
    setFields((current) =>
      current.map((field) => (field.id === selectedId ? { ...field, ...patch } : field)),
    );
  }

  function deleteSelected() {
    setFields((current) => current.filter((field) => field.id !== selectedId));
    setSelectedId(null);
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Paraphe, accueil">
          <span className="brand-mark">P</span>
          <span>Paraphe</span>
        </a>
        <nav aria-label="Navigation principale">
          <a href="#how">Fonctionnement</a>
          <button type="button" onClick={goToWorkspace}>Ouvrir l’espace</button>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Formulaires PDF mobiles</p>
            <h1 id="hero-title">Un PDF. Un formulaire. Une signature.</h1>
            <p className="hero-lead">
              Préparez vos documents une fois, puis laissez chacun les remplir et les signer depuis son téléphone.
            </p>
            <button className="hero-action" type="button" onClick={goToWorkspace}>
              Accéder aux documents <span aria-hidden="true">↘</span>
            </button>
          </div>
          <div className="hero-document" aria-hidden="true">
            <div className="paper paper-back" />
            <div className="paper paper-main">
              <span className="paper-title" />
              <span className="paper-line wide" />
              <span className="paper-line" />
              <span className="paper-field">Nom et prénom</span>
              <span className="paper-field short">Date</span>
              <span className="paper-signature">signature</span>
            </div>
            <span className="hero-stamp">prêt</span>
          </div>
        </section>

        <section className="how" id="how" aria-labelledby="how-title">
          <div className="how-heading">
            <span>01 → 03</span>
            <h2 id="how-title">Le document reste le repère.</h2>
          </div>
          <ol>
            <li><b>01</b><div><strong>Préparez</strong><p>Déposez le PDF et placez les zones de texte et de signature directement sur chaque page.</p></div></li>
            <li><b>02</b><div><strong>Remplissez</strong><p>Les zones deviennent un formulaire clair, dans l’ordre du document, adapté aux petits écrans.</p></div></li>
            <li><b>03</b><div><strong>Envoyez</strong><p>La signature au doigt est intégrée au PDF. La copie finale part vers l’adresse enregistrée.</p></div></li>
          </ol>
        </section>

        <section className="workspace" id="workspace" aria-labelledby="workspace-title">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">Espace documents</p>
              <h2 id="workspace-title">Préparer. Remplir. Envoyer.</h2>
            </div>
            {mode !== "upload" && (
              <button className="upload-button" type="button" onClick={openUpload}>
                <Icon name="upload" /> Déposer un PDF
              </button>
            )}
          </div>

          {!emailConfigured && (
            <div className="configuration-note">
              <Icon name="mail" />
              <span>L’envoi email sera actif dès que les paramètres SMTP seront renseignés dans le fichier <code>.env</code>.</span>
            </div>
          )}

          {notice && <div className={`notice ${notice.type}`} role="status">{notice.message}</div>}

          <div className="workspace-card">
            <WorkflowSteps mode={mode} />
            {loading && <LoadingLibrary />}
            {!loading && mode === "library" && (
              <Library
                templates={templates}
                onUpload={openUpload}
                onPrepare={openPrepare}
                onFill={openFill}
                onDelete={removeTemplate}
              />
            )}
            {!loading && mode === "upload" && (
              <UploadForm
                busy={busy}
                fileName={fileName}
                onFileName={setFileName}
                onSubmit={uploadTemplate}
                onBack={openLibrary}
              />
            )}
            {!loading && mode === "prepare" && activeTemplate && (
              <TemplateEditor
                template={activeTemplate}
                fields={fields}
                onFields={setFields}
                tool={tool}
                onTool={setTool}
                selectedId={selectedId}
                onSelect={setSelectedId}
                selectedField={selectedField}
                onPatch={patchSelected}
                onDeleteField={deleteSelected}
                onBack={openLibrary}
                onSave={saveFields}
                busy={busy}
              />
            )}
            {!loading && mode === "fill" && activeTemplate && (
              <FillForm
                template={activeTemplate}
                orderedFields={orderedTextFields}
                values={values}
                onValues={setValues}
                signature={signature}
                onSignature={setSignature}
                onBack={openLibrary}
                onSubmit={submitCompleted}
                busy={busy}
              />
            )}
            {!loading && mode === "complete" && completion && (
              <Completion
                result={completion}
                onEditForm={editCompletedForm}
                onNewCopy={startNewCopy}
                onEditZones={editSavedZones}
                onBack={openLibrary}
              />
            )}
          </div>
        </section>
      </main>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark">P</span><span>Paraphe</span></a>
        <p>Les PDF vierges sont conservés séparément. Chaque remplissage crée une nouvelle copie.</p>
        <small>Signature électronique simple. Vérifiez les exigences applicables à vos documents sensibles ou réglementés.</small>
      </footer>
    </div>
  );
}

function Library({ templates, onUpload, onPrepare, onFill, onDelete }) {
  return (
    <div className="library-view">
      <div className="view-title">
        <div><h3>Mes documents</h3><p>Choisissez le modèle que vous souhaitez remplir.</p></div>
        <span>{templates.length} modèle{templates.length > 1 ? "s" : ""}</span>
      </div>
      {templates.length ? (
        <div className="template-list">
          {templates.map((template) => {
            const ready = template.status === "ready" && template.fields.some((field) => field.type === "signature");
            return (
              <article className="template-row" key={template.id}>
                <div className="template-icon"><Icon name="document" /><small>{template.pageCount} p.</small></div>
                <div className="template-copy">
                  <div className="template-name">
                    <h4>{template.title}</h4>
                    <span className={`template-status ${ready ? "ready" : "draft"}`}>{ready ? "Prêt" : "À configurer"}</span>
                  </div>
                  <p>{template.fields.length} zone{template.fields.length > 1 ? "s" : ""} · Envoi vers {template.recipientEmail}</p>
                </div>
                <div className="template-actions">
                  {ready && <button className="prepare-link" type="button" onClick={() => onPrepare(template)}>Modifier les zones</button>}
                  <button className="fill-button" type="button" onClick={() => (ready ? onFill(template) : onPrepare(template))}>
                    <span>{ready ? "Remplir" : "Configurer"}</span><b aria-hidden="true">→</b>
                  </button>
                </div>
                <button className="delete-template" type="button" onClick={() => onDelete(template)} aria-label={`Supprimer ${template.title}`}><Icon name="trash" /></button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-paper"><Icon name="document" /></div>
          <h3>Aucun document pour le moment</h3>
          <p>Commencez par déposer le PDF qui servira de modèle.</p>
          <button type="button" onClick={onUpload}>Déposer mon premier PDF</button>
        </div>
      )}
    </div>
  );
}

function UploadForm({ busy, fileName, onFileName, onSubmit, onBack }) {
  return (
    <form className="upload-view" onSubmit={onSubmit}>
      <div className="upload-art" aria-hidden="true"><span /><span /><span><Icon name="upload" /></span></div>
      <div className="upload-fields">
        <button className="back-button" type="button" onClick={onBack}>← Mes documents</button>
        <p className="eyebrow">Nouveau modèle</p>
        <h3>Déposer un PDF vierge</h3>
        <p>Donnez-lui un nom clair et indiquez où chaque copie signée devra être envoyée.</p>
        <label htmlFor="template-title">Nom du document</label>
        <input id="template-title" name="title" required maxLength="120" placeholder="Exemple : Autorisation parentale" />
        <label htmlFor="recipient-email">Adresse de destination</label>
        <input id="recipient-email" name="recipientEmail" type="email" required maxLength="254" placeholder="service@exemple.fr" />
        <label className="file-control" htmlFor="pdf-file">
          <Icon name="document" />
          <span>{fileName || "Choisir un fichier PDF"}</span>
          <input id="pdf-file" name="file" type="file" required accept="application/pdf,.pdf" onChange={(event) => onFileName(event.target.files?.[0]?.name || "")} />
        </label>
        <small className="upload-help">PDF uniquement · 10 Mo maximum · sans mot de passe</small>
        <button className="primary-submit" type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Préparer le modèle"}</button>
      </div>
    </form>
  );
}

function TemplateEditor({
  template,
  fields,
  onFields,
  tool,
  onTool,
  selectedId,
  onSelect,
  selectedField,
  onPatch,
  onDeleteField,
  onBack,
  onSave,
  busy,
}) {
  const textCount = fields.filter((field) => field.type === "text").length;
  const signatureCount = fields.filter((field) => field.type === "signature").length;
  const labelsAreValid = fields.every((field) => field.label.trim());
  const canSave = fields.length > 0 && signatureCount > 0 && labelsAreValid;

  return (
    <div className="editor-view">
      <div className="editor-title">
        <button className="back-button" type="button" onClick={onBack}>← Mes documents</button>
        <div>
          <h3>{template.title}</h3>
          <p>Choisissez une zone, touchez le document pour la placer, puis ajustez sa taille et son libellé.</p>
        </div>
      </div>
      <div className="editor-grid">
        <aside className="toolbox" aria-label="Types de zones">
          <button type="button" aria-pressed={tool === "text"} className={tool === "text" ? "active" : ""} onClick={() => onTool("text")}><Icon name="text" /><span>Zone de texte</span></button>
          <button type="button" aria-pressed={tool === "signature"} className={tool === "signature" ? "active" : ""} onClick={() => onTool("signature")}><Icon name="signature" /><span>Signature</span></button>
        </aside>
        <PdfStage template={template} fields={fields} onFieldsChange={onFields} tool={tool} selectedId={selectedId} onSelect={onSelect} />
        <aside className="inspector">
          <h4>Propriétés</h4>
          {selectedField ? (
            <>
              <label htmlFor="field-label">Libellé du champ</label>
              <input id="field-label" value={selectedField.label} maxLength="80" onChange={(event) => onPatch({ label: event.target.value })} />
              <label className="required-control"><input type="checkbox" checked={selectedField.required} onChange={(event) => onPatch({ required: event.target.checked })} /><span>Champ obligatoire</span></label>
              <p>Page {selectedField.page + 1}. Tirez le coin inférieur droit pour modifier la taille.</p>
              <button className="remove-field" type="button" onClick={onDeleteField}>Supprimer cette zone</button>
            </>
          ) : (
            <p>Sélectionnez une zone sur le document pour la renommer, la rendre facultative ou la supprimer.</p>
          )}
        </aside>
      </div>
      <div className="editor-actions">
        <div className="editor-summary">
          <span>{textCount} texte{textCount > 1 ? "s" : ""} · {signatureCount} signature{signatureCount > 1 ? "s" : ""}</span>
          {!signatureCount && <small>Ajoutez au moins une zone de signature pour continuer.</small>}
          {!labelsAreValid && <small>Chaque zone doit avoir un libellé.</small>}
        </div>
        <button type="button" onClick={onSave} disabled={busy || !canSave}>{busy ? "Enregistrement…" : "Enregistrer les zones"}</button>
      </div>
    </div>
  );
}

function FillForm({ template, orderedFields, values, onValues, signature, onSignature, onBack, onSubmit, busy }) {
  const totalSteps = orderedFields.length + 1;
  const completedSteps = orderedFields.filter((field) => String(values[field.id] || "").trim()).length + (signature ? 1 : 0);
  const completionRate = Math.round((completedSteps / totalSteps) * 100);

  return (
    <form className="fill-view" onSubmit={onSubmit}>
      <div className="form-column">
        <button className="back-button" type="button" onClick={onBack}>← Mes documents</button>
        <div className="fill-title"><span>Étape 3 · Formulaire</span><h3>{template.title}</h3><p>Remplissez les champs dans l’ordre. La signature termine le document.</p></div>
        <div className="form-progress" aria-label={`${completedSteps} étape sur ${totalSteps} complétée`}>
          <div><strong>{completedSteps} / {totalSteps}</strong><span>{completionRate}% complété</span></div>
          <span><i style={{ width: `${completionRate}%` }} /></span>
        </div>
        {orderedFields.map((field, index) => (
          <div className="answer-field" key={field.id}>
            <label htmlFor={`answer-${field.id}`}><b>{String(index + 1).padStart(2, "0")}</b><span>{field.label}{field.required && <small>requis</small>}</span></label>
            <textarea id={`answer-${field.id}`} rows="1" required={field.required} maxLength="2000" value={values[field.id] || ""} onChange={(event) => onValues((current) => ({ ...current, [field.id]: event.target.value }))} />
          </div>
        ))}
        <SignaturePad stepNumber={totalSteps} value={signature} onChange={onSignature} />
        <div className="destination"><Icon name="mail" /><span>Envoi prévu vers <strong>{template.recipientEmail}</strong></span></div>
        <button className="sign-submit" type="submit" disabled={busy}>{busy ? "Création du PDF…" : "Créer le PDF et l’envoyer"}<span aria-hidden="true" /></button>
      </div>
      <aside className="preview-column">
        <p>Aperçu du document</p>
        <PdfStage template={template} fields={template.fields} readOnly />
      </aside>
    </form>
  );
}

function Completion({ result, onEditForm, onNewCopy, onEditZones, onBack }) {
  return (
    <div className="completion-view">
      <div className="completion-icon"><Icon name="check" /></div>
      <div className="completion-copy">
        <p className="eyebrow">Document finalisé</p>
        <h3>{result.emailSent ? "Document envoyé" : "PDF prêt à télécharger"}</h3>
        <p>{result.message}</p>
        <small>Les zones de texte et de signature restent enregistrées sur ce modèle.</small>
      </div>
      <div className="completion-actions">
        <a className="download-button" href={result.downloadUrl}><Icon name="download" /><span>Télécharger le PDF</span></a>
        <button className="completion-button primary" type="button" onClick={onEditForm}>Corriger cette copie</button>
        <button className="completion-button" type="button" onClick={onNewCopy}>Remplir une nouvelle copie</button>
        <button className="completion-button quiet" type="button" onClick={onEditZones}>Modifier les zones du modèle</button>
      </div>
      <button className="back-library" type="button" onClick={onBack}>Revenir à tous les documents</button>
    </div>
  );
}

function LoadingLibrary() {
  return <div className="loading-library" aria-label="Chargement des documents"><span /><span /><span /></div>;
}
