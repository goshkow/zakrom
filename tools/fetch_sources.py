#!/usr/bin/env python3
"""качает открытые данные для Закрома в data/sources/*.json.

python3 tools/fetch_sources.py              все источники по очереди
python3 tools/fetch_sources.py off osm      только выбранные: off, wikidata, osm, fx, commodities

что откуда:
  off          - товары из Open Food Facts (ODbL): штрихкод, название, бренд, фасовка, фото
  wikidata     - профили производителей по брендам из off (CC0): сайт, город, год основания, штат
  osm          - заводы, оптовики и упаковка из OpenStreetMap (ODbL) по крупным городам
  fx           - курсы ЦБ РФ за год (USD, EUR, CNY)
  commodities  - месячные биржевые цены сырья, Всемирный банк, Pink Sheet (CC BY 4.0)

все сервисы бесплатные и общие: запросы идут по одному, с паузами. запускать руками и редко,
результат лежит в репозитории, а сайт сам в эти сервисы не ходит (кроме проверки ИНН и штрихкода).
код возврата: 0 - всё записано, 1 - какой-то источник не ответил (его файл не тронут).
"""
from __future__ import annotations

import io
import json
import subprocess
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "sources"
USER_AGENT = "zakrom-demo/1.0 (github.com/goshkow; agoshkowi@gmail.com)"
CA_BUNDLES = ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt")
RETRY_STATUS = {429, 500, 502, 503, 504}

# категория Open Food Facts -> наша группа закупок; порядок групп = порядок цветов в графиках
OFF_CATEGORIES = [
    ("milks", "dairy"), ("creams", "dairy"), ("butters", "dairy"), ("cheeses", "dairy"),
    ("mozzarella", "dairy"), ("sour-creams", "dairy"), ("cottage-cheeses", "dairy"), ("tvorog", "dairy"),
    ("cream-cheeses", "dairy"), ("yogurts", "dairy"),
    ("sausages", "meat"), ("hams", "meat"), ("canned-fishes", "meat"), ("canned-meats", "meat"),
    ("frozen-vegetables", "produce"), ("canned-vegetables", "produce"), ("tomato-pastes", "produce"),
    ("canned-corn", "produce"), ("chips-and-fries", "produce"),
    ("flours", "grocery"), ("sugars", "grocery"), ("sunflower-oils", "grocery"), ("olive-oils", "grocery"),
    ("pastas", "grocery"), ("rices", "grocery"), ("buckwheat", "grocery"), ("eggs", "grocery"),
    ("salts", "grocery"), ("rolled-oats", "grocery"),
    ("ketchup", "sauces"), ("mayonnaises", "sauces"), ("mustards", "sauces"), ("soy-sauces", "sauces"),
    ("spices", "sauces"), ("honeys", "sauces"), ("jams", "sauces"), ("chocolates", "sauces"),
    ("cocoa-powders", "sauces"), ("condensed-milks", "sauces"), ("syrups", "sauces"),
    ("coffees", "drinks"), ("coffee-beans", "drinks"), ("ground-coffees", "drinks"), ("instant-coffees", "drinks"),
    ("teas", "drinks"), ("fruit-juices", "drinks"),
    ("waters", "drinks"), ("sodas", "drinks"),
]
OFF_PAGE_SIZE = 40
OFF_FIELDS = "code,product_name_ru,product_name,brands,quantity,image_front_small_url,nutriscore_grade,last_modified_t"
OFF_PAUSE_S = 4  # общий сервис: не чаще 15 запросов в минуту

# город -> рамка (юг, запад, север, восток). рамка, а не area: area на общем Overpass то и дело отдаёт пусто
OSM_CITIES = {
    "Москва": (55.45, 37.20, 56.05, 38.05),
    "Санкт-Петербург": (59.75, 30.05, 60.10, 30.60),
    "Екатеринбург": (56.70, 60.40, 56.95, 60.80),
    "Новосибирск": (54.85, 82.75, 55.15, 83.15),
    "Казань": (55.70, 48.95, 55.90, 49.30),
    "Нижний Новгород": (56.20, 43.75, 56.40, 44.10),
    "Краснодар": (44.95, 38.85, 45.15, 39.15),
    "Самара": (53.10, 50.05, 53.30, 50.35),
    "Ростов-на-Дону": (47.15, 39.55, 47.35, 39.85),
    "Челябинск": (55.05, 61.25, 55.30, 61.55),
}
OSM_ENDPOINT = "https://overpass-api.de/api/interpreter"
OSM_PAUSE_S = 8

CBR_CURRENCIES = {"USD": "R01235", "EUR": "R01239", "CNY": "R01375"}

WB_PAGE = "https://www.worldbank.org/en/research/commodity-markets"
# запасной адрес: ссылка на файл меняется каждый месяц, поэтому сначала ищем свежую на странице
WB_URL = (
    "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/"
    "related/CMO-Historical-Data-Monthly.xlsx"
)
# заголовок столбца в Pink Sheet -> наш ключ
WB_SERIES = {
    "Wheat, US HRW": "wheat",
    "Sugar, world": "sugar",
    "Cocoa": "cocoa",
    "Coffee, Arabica": "coffee",
    "Sunflower oil": "sunflower_oil",
    "Palm oil": "palm_oil",
    "Beef": "beef",
    "Chicken": "chicken",
    "Coffee, Robusta": "coffee_robusta",
    "Rice, Thai 5%": "rice",
    "Maize": "maize",
    "Tea, avg 3 auctions": "tea",
    "Orange": "orange",
}
WB_MONTHS = 60


def ssl_context() -> ssl.SSLContext:
    for bundle in CA_BUNDLES:
        if Path(bundle).exists():
            return ssl.create_default_context(cafile=bundle)
    return ssl.create_default_context()


CTX = ssl_context()


def http(url: str, *, data: bytes | None = None, accept: str = "application/json", timeout: int = 120, attempts: int = 4) -> bytes:
    """GET или POST с повтором: общие сервисы часто отвечают 429/504 под нагрузкой."""
    pause = 15
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Accept": accept})
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=CTX) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in RETRY_STATUS or attempt == attempts:
                raise
        except urllib.error.URLError as error:
            # сертификат cbr.ru выпущен российским УЦ, которого нет в наборе python. curl берёт системное хранилище
            if isinstance(error.reason, ssl.SSLCertVerificationError) and data is None:
                return curl(url, accept, timeout)
            if attempt == attempts:
                raise
        except TimeoutError:
            if attempt == attempts:
                raise
        print(f"  повтор через {pause} с: {url[:90]}", file=sys.stderr)
        time.sleep(pause)
        pause *= 2
    raise RuntimeError("unreachable")


def curl(url: str, accept: str, timeout: int) -> bytes:
    result = subprocess.run(
        ["curl", "-sS", "--fail", "-m", str(timeout), "-A", USER_AGENT, "-H", f"Accept: {accept}", url],
        capture_output=True, check=True,
    )
    return result.stdout


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write(name: str, payload: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)  # атомарно: недокачанный файл не затрёт прошлый снимок
    print(f"записано {path.relative_to(ROOT)}")


# ---------- Open Food Facts ----------

def off_search(tag: str) -> list[dict]:
    """поиск search-a-licious: он отвечает стабильнее, чем /api/v2/search под нагрузкой."""
    query = urllib.parse.urlencode({
        "q": f'categories_tags:"en:{tag}" AND countries_tags:"en:russia"',
        "fields": OFF_FIELDS + ",unique_scans_n",
        "page_size": OFF_PAGE_SIZE,
        "sort_by": "-unique_scans_n",
    })
    raw = json.loads(http(f"https://search.openfoodfacts.org/search?{query}"))
    hits = raw.get("hits", [])
    for hit in hits:
        # в search-a-licious бренды приходят списком, в /api/v2 - строкой через запятую
        if isinstance(hit.get("brands"), list):
            hit["brands"] = ", ".join(str(b) for b in hit["brands"])
    return hits


def fetch_off() -> None:
    # промежуточный файл: если сервис упадёт на середине, уже скачанные категории не теряются
    partial_path = OUT / ".off-partial.json"
    partial = json.loads(partial_path.read_text(encoding="utf-8")) if partial_path.exists() else {}
    for index, (tag, group) in enumerate(OFF_CATEGORIES):
        if tag in partial:
            continue
        if index:
            time.sleep(OFF_PAUSE_S)
        try:
            partial[tag] = off_search(tag)
        except urllib.error.URLError as error:
            print(f"  off {tag}: пропущено ({error})", file=sys.stderr)
            continue
        OUT.mkdir(parents=True, exist_ok=True)
        partial_path.write_text(json.dumps(partial, ensure_ascii=False), encoding="utf-8")
        print(f"  off {tag}: {len(partial[tag])}")
    missing = [tag for tag, _ in OFF_CATEGORIES if tag not in partial]
    if missing:
        raise RuntimeError(f"не скачались категории {missing}: запустите ещё раз, готовые не перекачиваются")
    products: dict[str, dict] = {}
    stats = {}
    for tag, group in OFF_CATEGORIES:
        found = 0
        for item in partial[tag]:
            code = str(item.get("code") or "").strip()
            if not code or code in products:
                continue
            item["_tag"] = tag
            item["_group"] = group
            products[code] = item
            found += 1
        stats[tag] = found
    write("off", {
        "source": "Open Food Facts",
        "url": "https://world.openfoodfacts.org",
        "license": "ODbL 1.0 (база), CC BY-SA 3.0 (фото)",
        "licenseUrl": "https://world.openfoodfacts.org/terms-of-use",
        "fetchedAt": now_iso(),
        "categories": stats,
        "products": list(products.values()),
    })
    partial_path.unlink()


# ---------- Wikidata ----------

WD_API = "https://www.wikidata.org/w/api.php"
WD_SPARQL = "https://query.wikidata.org/sparql"
RUSSIA = "Q159"


def wd_search(label: str) -> list[str]:
    query = urllib.parse.urlencode({
        "action": "wbsearchentities", "search": label, "language": "ru", "uselang": "ru",
        "type": "item", "limit": 5, "format": "json",
    })
    raw = json.loads(http(f"{WD_API}?{query}"))
    return [hit["id"] for hit in raw.get("search", [])]


def wd_entities(ids: list[str]) -> dict:
    result = {}
    for start in range(0, len(ids), 40):
        chunk = ids[start:start + 40]
        query = urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(chunk), "languages": "ru|en",
            "props": "labels|descriptions|claims|sitelinks", "format": "json",
        })
        raw = json.loads(http(f"{WD_API}?{query}"))
        result.update(raw.get("entities", {}))
        time.sleep(1)
    return result


def claim_ids(entity: dict, prop: str) -> list[str]:
    out = []
    for claim in entity.get("claims", {}).get(prop, []):
        value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(value, dict) and "id" in value:
            out.append(value["id"])
    return out


# отрасли Wikidata -> наша группа закупок; отсюда берём производителей, даже если их товаров нет в OFF
WD_INDUSTRIES = {
    "Q540912": "food", "Q13554450": "dairy", "Q955043": "meat", "Q635139": "meat", "Q861182": "meat",
    "Q4498099": "sauces", "Q4899370": "drinks", "Q19966097": "grocery", "Q2283886": "packaging",
}


def wd_companies() -> list[str]:
    values = " ".join(f"wd:{q}" for q in WD_INDUSTRIES)
    query = f"""SELECT DISTINCT ?c WHERE {{
  VALUES ?ind {{ {values} }}
  ?c wdt:P452 ?ind ; wdt:P17 wd:Q159 .
  FILTER NOT EXISTS {{ ?c wdt:P576 ?dissolved }}
}}"""
    raw = json.loads(http(f"{WD_SPARQL}?{urllib.parse.urlencode({'query': query, 'format': 'json'})}", accept="application/sparql-results+json"))
    return [row["c"]["value"].rsplit("/", 1)[-1] for row in raw["results"]["bindings"]]


def top_brands(limit: int = 160) -> list[str]:
    """бренды, у которых больше всего товаров в нашем снимке OFF: их и ищем в Wikidata."""
    off = json.loads((OUT / "off.json").read_text(encoding="utf-8"))
    counts: dict[str, int] = {}
    for product in off["products"]:
        brand = str(product.get("brands") or "").split(",")[0].strip()
        if len(brand) >= 2:
            counts[brand] = counts.get(brand, 0) + 1
    return [brand for brand, _ in sorted(counts.items(), key=lambda pair: -pair[1])[:limit]]


def fetch_wikidata() -> None:
    brands = top_brands()
    candidates: dict[str, list[str]] = {}
    for brand in brands:
        try:
            candidates[brand] = wd_search(brand)
        except urllib.error.URLError as error:
            print(f"  wikidata поиск {brand}: {error}", file=sys.stderr)
            candidates[brand] = []
        time.sleep(1)
    try:
        companies = wd_companies()
    except urllib.error.URLError as error:
        print(f"  wikidata отрасли: {error}", file=sys.stderr)
        companies = []
    print(f"  wikidata: {len(companies)} компаний по отраслям")
    ids = sorted({qid for hits in candidates.values() for qid in hits} | set(companies))
    entities = wd_entities(ids)
    # у бренда-товарного знака владелец лежит в P1716 или P127: его профиль тоже нужен
    owners = sorted({owner for entity in entities.values() for owner in claim_ids(entity, "P1716") + claim_ids(entity, "P127")} - set(entities))
    entities.update(wd_entities(owners))
    # города штаб-квартир: только подписи и координаты
    places = sorted({place for entity in entities.values() for place in claim_ids(entity, "P159")} - set(entities))
    entities.update(wd_entities(places))
    write("wikidata", {
        "source": "Wikidata",
        "url": "https://www.wikidata.org",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "fetchedAt": now_iso(),
        "candidates": candidates,
        "industryCompanies": companies,
        "industryGroups": WD_INDUSTRIES,
        "entities": {qid: slim_entity(entity) for qid, entity in entities.items() if "missing" not in entity},
    })


def slim_entity(entity: dict) -> dict:
    """из Wikidata храним только то, что показываем: так снимок остаётся маленьким и читаемым."""
    claims = entity.get("claims", {})

    def values(prop: str) -> list:
        out = []
        for claim in claims.get(prop, []):
            if claim.get("rank") == "deprecated":
                continue
            value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
            if value is not None:
                out.append(value)
        return out

    def text(kind: str) -> str:
        block = entity.get(kind, {})
        return (block.get("ru") or block.get("en") or {}).get("value", "")

    return {
        "id": entity.get("id"),
        "label": text("labels"),
        "description": text("descriptions"),
        "instanceOf": claim_ids(entity, "P31"),
        "dissolved": bool(claims.get("P576")),
        "country": claim_ids(entity, "P17") + claim_ids(entity, "P495"),
        "hq": claim_ids(entity, "P159"),
        "owner": claim_ids(entity, "P1716") + claim_ids(entity, "P127") + claim_ids(entity, "P749"),
        "industry": claim_ids(entity, "P452"),
        "website": [v for v in values("P856") if isinstance(v, str)][:1],
        "inception": [v.get("time") for v in values("P571") if isinstance(v, dict)][:1],
        "employees": [v.get("amount") for v in values("P1128") if isinstance(v, dict)][:1],
        "ogrn": [v for v in values("P7011") if isinstance(v, str)][:1],
        "logo": [v for v in values("P154") if isinstance(v, str)][:1],
        "coords": [{"lat": v.get("latitude"), "lon": v.get("longitude")} for v in values("P625") if isinstance(v, dict)][:1],
        "ruwiki": entity.get("sitelinks", {}).get("ruwiki", {}).get("title"),
    }


# ---------- OpenStreetMap ----------

def fetch_osm() -> None:
    elements = []
    stamp = None
    for index, (city, (south, west, north, east)) in enumerate(OSM_CITIES.items()):
        if index:
            time.sleep(OSM_PAUSE_S)
        query = f"""[out:json][timeout:180][bbox:{south},{west},{north},{east}];
(
  nwr["name"]["man_made"="works"];
  nwr["name"]["industrial"~"^(food|food_industry|bakery|dairy|meat|brewery|confectionery|packaging|mill|grinding_mill|slaughterhouse|fish|beverage|distillery|sugar|oil_mill|grain|plastics|paper)$"];
  nwr["name"]["shop"="wholesale"];
  nwr["name"]["craft"~"^(bakery|confectionery|caterer|cheese_maker|brewery|coffee_roaster)$"]["website"];
);
out tags center meta;"""
        raw = json.loads(http(OSM_ENDPOINT, data=urllib.parse.urlencode({"data": query}).encode(), timeout=240))
        stamp = raw.get("osm3s", {}).get("timestamp_osm_base") or stamp
        for element in raw.get("elements", []):
            element["_city"] = city
            elements.append(element)
        print(f"  osm {city}: {len(raw.get('elements', []))}")
    write("osm", {
        "source": "OpenStreetMap",
        "url": "https://www.openstreetmap.org",
        "license": "ODbL 1.0",
        "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attributionUrl": "https://www.openstreetmap.org/copyright",
        "fetchedAt": now_iso(),
        "osmBase": stamp,
        "elements": elements,
    })


# ---------- ЦБ РФ ----------

def fetch_fx() -> None:
    today = date.today()
    start = today - timedelta(days=400)
    series = {}
    for code, cbr_id in CBR_CURRENCIES.items():
        query = urllib.parse.urlencode({
            "date_req1": start.strftime("%d/%m/%Y"), "date_req2": today.strftime("%d/%m/%Y"), "VAL_NM_RQ": cbr_id,
        })
        root = ET.fromstring(http(f"https://www.cbr.ru/scripts/XML_dynamic.asp?{query}", accept="application/xml"))
        points = []
        for record in root.findall("Record"):
            day = datetime.strptime(record.get("Date"), "%d.%m.%Y").date().isoformat()
            nominal = int(record.findtext("Nominal", "1"))
            value = float(record.findtext("Value", "0").replace(",", "."))
            points.append([day, round(value / nominal, 4)])
        series[code] = points
        print(f"  fx {code}: {len(points)}")
        time.sleep(1)
    write("fx", {
        "source": "Банк России",
        "url": "https://www.cbr.ru/currency_base/dynamics/",
        "license": "открытые данные Банка России",
        "fetchedAt": now_iso(),
        "series": series,
    })


# ---------- Всемирный банк, Pink Sheet ----------

XLSX_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - 64)
    return index - 1


def read_sheet(book: zipfile.ZipFile, wanted: str) -> list[list[str]]:
    """минимальный разбор xlsx без openpyxl: нужен один лист с числами и строками."""
    shared = []
    if "xl/sharedStrings.xml" in book.namelist():
        root = ET.fromstring(book.read("xl/sharedStrings.xml"))
        for item in root.findall("m:si", XLSX_NS):
            shared.append("".join(node.text or "" for node in item.iter(f"{{{XLSX_NS['m']}}}t")))
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    rel_target = {rel.get("Id"): rel.get("Target") for rel in rels}
    sheet_path = None
    for sheet in workbook.find("m:sheets", XLSX_NS):
        if sheet.get("name") == wanted:
            rid = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            target = rel_target[rid].lstrip("/")
            sheet_path = target if target.startswith("xl/") else f"xl/{target}"
    if not sheet_path:
        raise ValueError(f"нет листа {wanted}")
    root = ET.fromstring(book.read(sheet_path))
    rows = []
    for row in root.iter(f"{{{XLSX_NS['m']}}}row"):
        cells: dict[int, str] = {}
        for cell in row.findall("m:c", XLSX_NS):
            value = cell.findtext("m:v", default="", namespaces=XLSX_NS)
            if cell.get("t") == "s" and value:
                value = shared[int(value)]
            elif cell.get("t") == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter(f"{{{XLSX_NS['m']}}}t"))
            cells[col_index(cell.get("r"))] = value
        if cells:
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
    return rows


def fetch_commodities() -> None:
    url = WB_URL
    try:
        page = http(WB_PAGE, accept="text/html").decode("utf-8", "replace")
        found = re.findall(r"https://thedocs\.worldbank\.org/[^\"']*CMO-Historical-Data-Monthly\.xlsx", page)
        if found:
            url = found[0]
    except urllib.error.URLError:
        pass
    book = zipfile.ZipFile(io.BytesIO(http(url, accept="*/*", timeout=180)))
    rows = read_sheet(book, "Monthly Prices")
    header_row = next(i for i, row in enumerate(rows) if any(cell.strip() == "Cocoa" for cell in row))
    # у части столбцов в заголовке сноска: «Beef **»
    header = [cell.strip().rstrip("*").strip() for cell in rows[header_row]]
    units = [cell.strip() for cell in rows[header_row + 1]] if header_row + 1 < len(rows) else []
    columns = {key: header.index(title) for title, key in WB_SERIES.items() if title in header}
    missing = sorted(set(WB_SERIES) - {title for title in WB_SERIES if title in header})
    if missing:
        print(f"  commodities: нет столбцов {missing}", file=sys.stderr)
    data_rows = [row for row in rows[header_row + 1:] if row and re.match(r"^\d{4}M\d{2}$", row[0].strip())]
    data_rows = data_rows[-WB_MONTHS:]
    series = {}
    for key, column in columns.items():
        points = []
        for row in data_rows:
            month = row[0].strip()
            raw = row[column] if column < len(row) else ""
            try:
                value = float(raw)
            except ValueError:
                continue
            points.append([f"{month[:4]}-{month[5:]}", round(value, 4)])
        series[key] = {"title": next(t for t, k in WB_SERIES.items() if k == key), "unit": units[column] if column < len(units) else "", "points": points}
    write("commodities", {
        "source": "World Bank Commodity Price Data (The Pink Sheet)",
        "url": WB_PAGE,
        "file": url,
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "fetchedAt": now_iso(),
        "series": series,
    })


JOBS = {"off": fetch_off, "wikidata": fetch_wikidata, "osm": fetch_osm, "fx": fetch_fx, "commodities": fetch_commodities}


def main(argv: list[str]) -> int:
    wanted = argv or list(JOBS)
    unknown = [name for name in wanted if name not in JOBS]
    if unknown:
        print(f"неизвестные источники: {unknown}; есть {list(JOBS)}", file=sys.stderr)
        return 2
    failed = []
    for name in wanted:
        print(f"{name}…")
        try:
            JOBS[name]()
        except Exception as error:  # noqa: BLE001 - один упавший источник не должен ронять остальные
            print(f"  {name} не скачался: {error}", file=sys.stderr)
            failed.append(name)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
