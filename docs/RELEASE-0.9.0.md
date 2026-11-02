# Grok Workbench 0.9.0 alpha

This release adds prompt-driven desktop workflows while retaining embedded **Grok Build 1.0.45**, source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, binding 0.6.0. It includes the selected-window desktop bridge and text/PDF/DOCX read aloud previously available in development source. No CLI 1.0.70 migration or native storage-contract change is introduced.

- **Office:** edit new Word/Excel/PowerPoint copies, track Word changes/comments, recalculate Excel and create slides/PDFs.
- **Documents:** PDF forms, merge/split/select, visible annotations, text/table extraction and offline Windows OCR.
- **Science:** CSV/XLSX → native JMP fit and residual diagnostics → illustrated Word report, optional Excel chart and PowerPoint/PDF.
- **Files:** reviewed rename/organization plans, duplicate reporting and journaled undo, without overwriting existing files.
- **Browser:** separate task browser with page/control observations, form preparation, explicit submission review and bounded report downloads.
- **Art:** Blender batches, owned-document Krita exports, hash-approved built-in local ComfyUI workflows, editable SVG/PNG and optional native Inkscape vector-PDF exports.
- **Research:** CSL/RIS interchange, cited notes/bibliography/Word reports and an opt-in reviewed local Zotero adapter.
- **Audio:** trim/join/peak-normalize recordings and narration to PCM WAV, plus optional Audacity handoff/scripting.

New tools are opt-in per chat, expose real job outcomes/artifacts and preserve source documents. Application APIs/MCP and selected-window controls have different scopes; they do not provide universal desktop proficiency or OS containment. See [setup and detailed limits](DESKTOP-WORKFLOWS.md), [application integrations](APPLICATION-WORKFLOWS.md) and [validation](VALIDATION.md).

Windows remains an unsigned alpha. Linux x64 packages are experimental. Both Mac architectures remain **UNTESTED until volunteer desktop validation**; Windows application automation/OCR does not become cross-platform through packaging. Preserve `Grok Desktop Data` beside the Windows portable executable when updating. Existing profiles/history and the embedded engine contract are retained.

Publication uses the exact accepted CI packages from the same source commit for Windows, Linux and both Mac architectures, with checksums/manifests and release provenance. Native/library protocol fixtures do not certify real retailer checkout, online chess, arbitrary Office files, statistical assumptions, advanced custom-node workflows or unattended UI reliability.
