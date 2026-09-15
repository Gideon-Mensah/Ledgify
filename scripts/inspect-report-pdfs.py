"""Render every report page, reject leaked internal data and verify print pagination."""
import json
import re
import runpy
import sys
from pathlib import Path
import pymupdf

root = Path(sys.argv[1])
runpy.run_path(str(Path(__file__).with_name('inspect-document-pdfs.py')), run_name='__main__')
rows = json.loads((root / 'pdf-inspection.json').read_text())
for path in sorted(root.glob('*.pdf')):
    document = pymupdf.open(path)
    for index, page in enumerate(document):
        content = page.get_text()
        normalized = ' '.join(content.split())
        assert '[object Object]' not in content, (path.name, index + 1)
        assert not re.search(r'"(?:id|account_type|organisation|serializer_metadata)"\s*:', content), (path.name, index + 1)
        assert not re.search(r'\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b', content, re.I), (path.name, index + 1)
        meaningful = re.sub(r'Page\s+\d+(?:\s+of\s+\d+)?', '', normalized).strip()
        assert len(meaningful) > 30, ('Empty body', path.name, index + 1)
        width, height = sorted((page.rect.width, page.rect.height))
        assert abs(width - 595.28) < 2 and abs(height - 841.89) < 2, ('Not A4', path.name)
        if len(document) > 1 and ('trial-balance' in path.name or 'large-trial' in path.name):
            assert 'Account name' in normalized and 'Debit' in normalized and 'Credit' in normalized, ('Missing repeated headings', path.name, index + 1)
print(f"PASS: {len(rows)} report pages; no internal UUIDs, raw object metadata, blank bodies or non-A4 pages; multipage Trial Balance headings repeat.")
