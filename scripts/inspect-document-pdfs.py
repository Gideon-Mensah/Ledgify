from pathlib import Path
import pymupdf as fitz
import json,sys
root=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/ledgify-phase3-artifacts');results=[]
for path in sorted(root.glob('*.pdf')):
 doc=fitz.open(path)
 for i,page in enumerate(doc):
  text=page.get_text();assert text.strip(),f'Blank {path.name} page {i+1}'
  out=root/f'{path.stem}-page-{i+1}.png';page.get_pixmap(matrix=fitz.Matrix(1,1)).save(out)
  blocks=page.get_text('blocks');outside=[b[:4] for b in blocks if b[0]<-1 or b[1]<-1 or b[2]>page.rect.width+1 or b[3]>page.rect.height+1]
  assert not outside,f'Clipped text in {path.name} page {i+1}: {outside}'
  results.append({'file':path.name,'page':i+1,'characters':len(text),'out_of_bounds':outside,'image':str(out)})
(root/'pdf-inspection.json').write_text(json.dumps(results,indent=2));print(f"Inspected {len(results)} non-empty pages in {len(set(row['file'] for row in results))} PDFs; no out-of-bounds text. Manually inspect the rendered images for overlap.")
