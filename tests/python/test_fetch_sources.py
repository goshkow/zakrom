"""тесты сборщика открытых данных: без сети, на маленьких самодельных ответах."""
from __future__ import annotations

import io
import json
import ssl
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))

import fetch_sources as fs  # noqa: E402


def make_xlsx(rows: list[list[object]], sheet: str = "Monthly Prices") -> bytes:
    """минимальный xlsx: общие строки + один лист, как в Pink Sheet."""
    shared: list[str] = []

    def cell(ref: str, value: object) -> str:
        if isinstance(value, (int, float)):
            return f'<c r="{ref}"><v>{value}</v></c>'
        shared.append(str(value))
        return f'<c r="{ref}" t="s"><v>{len(shared) - 1}</v></c>'

    xml_rows = []
    for r, row in enumerate(rows, start=1):
        cells = "".join(cell(f"{chr(65 + c)}{r}", v) for c, v in enumerate(row) if v != "")
        xml_rows.append(f'<row r="{r}">{cells}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} {rel}><sheets><sheet name="Notes" sheetId="1" r:id="rId1"/><sheet name="{sheet}" sheetId="2" r:id="rId2"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData/></worksheet>")
        z.writestr("xl/worksheets/sheet2.xml", f"<worksheet {ns}><sheetData>{''.join(xml_rows)}</sheetData></worksheet>")
        items = "".join(f"<si><t>{s}</t></si>" for s in shared)
        z.writestr("xl/sharedStrings.xml", f"<sst {ns}>{items}</sst>")
    return buf.getvalue()


class XlsxTest(unittest.TestCase):
    def test_col_index(self):
        self.assertEqual(fs.col_index("A1"), 0)
        self.assertEqual(fs.col_index("Z9"), 25)
        self.assertEqual(fs.col_index("AA10"), 26)

    def test_read_sheet_with_shared_strings_and_gaps(self):
        data = make_xlsx([["World Bank"], ["", "Cocoa", "Beef **"], ["", "($/kg)", "($/kg)"], ["2026M08", 5.5, ""], ["2026M09", 5.9, 6.8]])
        rows = fs.read_sheet(zipfile.ZipFile(io.BytesIO(data)), "Monthly Prices")
        self.assertEqual(rows[1], ["", "Cocoa", "Beef **"])
        self.assertEqual(rows[3], ["2026M08", "5.5"])
        self.assertEqual(rows[4][2], "6.8")

    def test_missing_sheet(self):
        data = make_xlsx([["x"]], sheet="Annual")
        with self.assertRaises(ValueError):
            fs.read_sheet(zipfile.ZipFile(io.BytesIO(data)), "Monthly Prices")

    def test_fetch_commodities_parses_footnotes_and_months(self):
        rows = [["Monthly prices"], ["", "Cocoa", "Beef **", "Wheat, US HRW"], ["", "($/kg)", "($/kg)", "($/mt)"]]
        rows += [[f"2026M{m:02d}", 5 + m / 10, 6.0, 300 + m] for m in range(1, 10)]
        data = make_xlsx(rows)
        written = {}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(fs, "OUT", Path(tmp)), mock.patch.object(fs, "http", side_effect=[b"<html>no link</html>", data]), mock.patch.object(fs, "write", side_effect=lambda name, payload: written.update({name: payload})):
            fs.fetch_commodities()
        series = written["commodities"]["series"]
        self.assertEqual(series["beef"]["points"][-1], ["2026-09", 6.0])
        self.assertEqual(series["wheat"]["unit"], "($/mt)")
        self.assertEqual(len(series["cocoa"]["points"]), 9)


class WikidataTest(unittest.TestCase):
    def test_slim_entity_keeps_only_shown_fields(self):
        entity = {
            "id": "Q1",
            "labels": {"ru": {"value": "Лианозовский молочный комбинат"}},
            "descriptions": {"en": {"value": "dairy plant"}},
            "claims": {
                "P31": [{"mainsnak": {"datavalue": {"value": {"id": "Q4830453"}}}}],
                "P17": [{"mainsnak": {"datavalue": {"value": {"id": "Q159"}}}}],
                "P856": [{"rank": "deprecated", "mainsnak": {"datavalue": {"value": "http://old.example"}}}, {"mainsnak": {"datavalue": {"value": "https://lmk.example"}}}],
                "P571": [{"mainsnak": {"datavalue": {"value": {"time": "+1989-00-00T00:00:00Z"}}}}],
                "P1128": [{"mainsnak": {"datavalue": {"value": {"amount": "+2200"}}}}],
                "P576": [{"mainsnak": {"datavalue": {"value": {"time": "+2020-01-01T00:00:00Z"}}}}],
            },
            "sitelinks": {"ruwiki": {"title": "Лианозовский молочный комбинат"}},
        }
        slim = fs.slim_entity(entity)
        self.assertEqual(slim["label"], "Лианозовский молочный комбинат")
        self.assertEqual(slim["description"], "dairy plant")
        self.assertEqual(slim["website"], ["https://lmk.example"])
        self.assertEqual(slim["inception"], ["+1989-00-00T00:00:00Z"])
        self.assertEqual(slim["country"], ["Q159"])
        self.assertTrue(slim["dissolved"])
        self.assertNotIn("claims", slim)


class HttpTest(unittest.TestCase):
    def test_ssl_error_falls_back_to_curl(self):
        error = urllib.error.URLError(ssl.SSLCertVerificationError("bad issuer"))
        with mock.patch("urllib.request.urlopen", side_effect=error), mock.patch.object(fs, "curl", return_value=b"ok") as curl:
            self.assertEqual(fs.http("https://www.cbr.ru/x"), b"ok")
            curl.assert_called_once()

    def test_retry_then_give_up_on_404(self):
        error = urllib.error.HTTPError("https://x", 404, "nf", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=error), mock.patch("time.sleep") as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                fs.http("https://x")
            sleep.assert_not_called()

    def test_write_is_atomic_json(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(fs, "OUT", Path(tmp)), mock.patch.object(fs, "ROOT", Path(tmp)):
            fs.write("fx", {"a": "б"})
            self.assertEqual(json.loads((Path(tmp) / "fx.json").read_text(encoding="utf-8")), {"a": "б"})
            self.assertFalse((Path(tmp) / "fx.tmp").exists())

    def test_unknown_source_is_rejected(self):
        self.assertEqual(fs.main(["нет"]), 2)


if __name__ == "__main__":
    unittest.main()
