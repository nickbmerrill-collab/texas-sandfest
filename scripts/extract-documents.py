from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "documents"
OUT = ROOT / "data" / "processed" / "documents"
OUT.mkdir(parents=True, exist_ok=True)

for pdf in sorted(RAW.glob("*.pdf")):
    reader = PdfReader(str(pdf))
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        pages.append(f"--- page {index} ---\n{page.extract_text() or ''}")
    destination = OUT / f"{pdf.stem}.txt"
    destination.write_text("\n\n".join(pages), encoding="utf-8")
    print(f"{pdf.name}: {len(reader.pages)} pages -> {destination.relative_to(ROOT)}")
