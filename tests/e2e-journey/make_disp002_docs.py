"""Generate test PNG documents for DISP-002 health check.

Run once before the browser test (or whenever the test docs are missing):
    python tests/e2e-journey/make_disp002_docs.py

Generates:
    tests/e2e-journey/test_docs/nda.png              (NDA)
    tests/e2e-journey/test_docs/asset_return.png     (Asset Return Form)
    tests/e2e-journey/test_docs/company_asset_decl.png (Company Asset Declaration)

All three are real rendered images that Tesseract/pytesseract can read back
verbatim -- same OCR path as a genuine scanned document, no mocking.
Keywords match the VALIDATION_RULES in agents/spokes/doc_collection.py.
Employee name matches exit_cases.employee_name for DISP-002 exactly.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "test_docs")
EMP_NAME = "Disposable Test 002"
DATE = "26-Sep-2026"


def _font(size):
    for name in ("arial.ttf", "Arial.ttf", r"C:\Windows\Fonts\arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except (IOError, OSError):
            pass
    return ImageFont.load_default()


def _write(filename, lines):
    img = Image.new("RGB", (900, 520), "white")
    draw = ImageDraw.Draw(img)
    font = _font(28)
    draw.multiline_text((30, 30), "\n".join(lines), fill="black", font=font, spacing=14)
    path = os.path.join(OUT_DIR, filename)
    img.save(path)
    print(f"  wrote: {path}")


os.makedirs(OUT_DIR, exist_ok=True)

_write("nda.png", [
    "NON-DISCLOSURE AGREEMENT",
    "",
    f"Employee: {EMP_NAME}",
    "This confidential agreement is entered into by the employee",
    "to protect company trade secrets after departure.",
    "All non-disclosure obligations remain in effect.",
    "",
    f"Signature: {EMP_NAME}",
    f"Date: {DATE}",
])

_write("asset_return.png", [
    "ASSET RETURN FORM",
    "",
    f"Employee: {EMP_NAME}",
    "Assets returned:",
    "  - Laptop (Asset Tag: LAP-0042)",
    "  - Access Badge",
    "All assets have been returned and accounted for.",
    f"Return confirmed by: {EMP_NAME}",
    f"Date: {DATE}",
])

_write("company_asset_decl.png", [
    "COMPANY ASSET DECLARATION",
    "",
    f"Employee: {EMP_NAME}",
    "I declare that all company assets in my possession",
    "have been returned or accounted for.",
    "",
    f"Signed: {EMP_NAME}",
    f"Date: {DATE}",
])

print(f"\nTest docs ready in: {OUT_DIR}")
