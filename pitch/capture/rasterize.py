import sys, os
import fitz

pdf, out = sys.argv[1], sys.argv[2]
doc = fitz.open(pdf)
n = 0
for i in range(min(2, len(doc))):
    doc[i].get_pixmap(matrix=fitz.Matrix(2, 2)).save(os.path.join(out, f"notes_page{i+1}.png"))
    n += 1
print(f"{n} pages rasterized of {len(doc)}")
