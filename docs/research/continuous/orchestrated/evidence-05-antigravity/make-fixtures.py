"""Deterministic attachment fixtures for 05-antigravity-attachment-retrieval.md.

Writes valid inputs that Rocket's real AttachmentStore accepts:
  small.png   64x64 PNG (solid colour)
  thumb.jpg   32x32 JPEG thumbnail (AttachmentStore.import requires a JPEG <= 320 px)
  text.pdf    one-page PDF with an extractable text layer (pdftotext reads it)
  scanned.pdf one-page PDF holding only an image (pdftotext extracts nothing)
Run: python3 make-fixtures.py OUTDIR
"""
import os
import sys
from PIL import Image

here = sys.argv[1]
os.makedirs(here, exist_ok=True)

Image.new('RGB', (64, 64), (40, 120, 200)).save(os.path.join(here, 'small.png'))
Image.new('RGB', (32, 32), (40, 120, 200)).save(os.path.join(here, 'thumb.jpg'), 'JPEG')
Image.new('RGB', (200, 200), (255, 255, 255)).save(os.path.join(here, 'scanned.pdf'), 'PDF')

# A minimal text PDF written by hand so xref offsets are exact
text = 'Bounded context fixture PDF with extractable content for search testing. ' * 10
stream = f'BT /F1 10 Tf 20 700 Td ({text}) Tj ET'.encode()
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
out = bytearray(b'%PDF-1.4\n')
offsets = []
for number, body in enumerate(objects, 1):
    offsets.append(len(out))
    out += f'{number} 0 obj\n'.encode() + body + b'\nendobj\n'
xref = len(out)
out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
for offset in offsets:
    out += f'{offset:010d} 00000 n \n'.encode()
out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
with open(os.path.join(here, 'text.pdf'), 'wb') as handle:
    handle.write(out)

for name in sorted(os.listdir(here)):
    print(name, os.path.getsize(os.path.join(here, name)))
