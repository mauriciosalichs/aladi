"""
Aladi library catalog scraper.
Handles authentication and data extraction from aladi.diba.cat
"""
import re
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://aladi.diba.cat"
SCOPE = "171"


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    })
    return s


class AladiClient:
    """Stateful client that keeps a logged-in requests session."""

    PATRON_URL = f"{BASE_URL}/patroninfo*"
    SEARCH_URL = f"{BASE_URL}/search~S{SCOPE}/"

    def __init__(self):
        self.session = _session()
        self.patron_id: str | None = None
        self.patron_name: str | None = None
        self._barcode: str = ""

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, barcode: str, pin: str) -> bool:
        """Authenticate with the library.  Returns True on success."""
        # Prime the session / get cookies
        self.session.get(self.PATRON_URL, timeout=15)

        resp = self.session.post(
            self.PATRON_URL,
            data={"code": barcode, "pin": pin},
            headers={
                "Referer": self.PATRON_URL,
                "Origin": BASE_URL,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            allow_redirects=True,
            timeout=15,
        )

        if resp.status_code != 200:
            return False

        # Extract patron ID from redirect URL
        m = re.search(r"/patroninfo~S\d+/(\d+)/", resp.url)
        if not m:
            return False

        self.patron_id = m.group(1)
        self._barcode = barcode
        soup = BeautifulSoup(resp.text, "lxml")

        # Extract name from logged-in message
        msg = soup.find("span", class_="loggedInMessage")
        if msg:
            name_m = re.search(r"as (.+)$", msg.get_text(strip=True))
            self.patron_name = name_m.group(1) if name_m else "User"

        return True

    def logout(self):
        try:
            self.session.get(f"{BASE_URL}/logout~S{SCOPE}?", timeout=10)
        except Exception:
            pass
        self.patron_id = None
        self.patron_name = None
        self.session = _session()

    @property
    def is_logged_in(self) -> bool:
        return self.patron_id is not None

    def get_cookies(self) -> dict:
        """Return current session cookies as a plain dict for persistence."""
        return dict(self.session.cookies)

    def restore_session(
        self,
        cookies: dict,
        patron_id: str,
        patron_name: str,
        barcode: str = "",
    ) -> bool:
        """
        Restore a previously saved session from stored cookies.
        Verifies the session is still active by hitting the patron page.
        Returns True if the session is valid, False if it has expired.
        """
        if not cookies or not patron_id:
            return False

        for name, value in cookies.items():
            self.session.cookies.set(name, value)

        self.patron_id = patron_id
        self.patron_name = patron_name
        self._barcode = barcode

        # Verify the server still honours these cookies
        try:
            url = f"{BASE_URL}/patroninfo~S{SCOPE}/{patron_id}/items"
            resp = self.session.get(url, timeout=10, allow_redirects=True)
            # A valid session keeps us on the patroninfo page; an expired one
            # redirects to / or /patroninfo* (the login form).
            if resp.status_code == 200 and "/patroninfo~S" in resp.url:
                return True
        except Exception:
            pass

        # Session expired — reset state
        self.patron_id = None
        self.patron_name = None
        self._barcode = ""
        return False

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    SEARCH_TYPES = {
        "X": "Any keyword",
        "t": "Title",
        "a": "Author / Artist",
        "d": "Subject",
        "i": "ISBN / ISSN",
        "c": "Call number",
    }

    SCOPES = {
        "171": "All catalog",
        "174": "Music",
        "175": "Films",
        "173": "Comics",
        "172": "Online resources",
        "176": "Audiobooks / Large print / Braille",
        "160": "Alt Penedès",
        "161": "Anoia",
        "162": "Bages i Moianès",
        "163": "Baix Llobregat",
        "164": "Barcelonès",
        "165": "Berguedà",
        "166": "Garraf",
        "167": "Maresme",
        "168": "Osona",
        "169": "Vallès Occidental",
        "170": "Vallès Oriental",
    }

    # Ordered groups for <optgroup> rendering in the search form.
    SCOPE_GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
        ("All catalog", [
            ("171", "All catalog"),
        ]),
        ("Collections", [
            ("174", "Music"),
            ("175", "Films"),
            ("173", "Comics / Amb vinyetes"),
            ("172", "Online resources"),
            ("176", "Audiobooks / Large print / Braille"),
        ]),
        ("By region (comarca)", [
            ("160", "Alt Penedès"),
            ("161", "Anoia"),
            ("162", "Bages i Moianès"),
            ("163", "Baix Llobregat"),
            ("164", "Barcelonès"),
            ("165", "Berguedà"),
            ("166", "Garraf"),
            ("167", "Maresme"),
            ("168", "Osona"),
            ("169", "Vallès Occidental"),
            ("170", "Vallès Oriental"),
        ]),
    ]

    def search(
        self,
        query: str,
        search_type: str = "X",
        scope: str = "171",
        sort: str = "D",
        page: int = 1,
        available_only: bool = False,
    ) -> dict:
        """
        Search the catalog.

        Returns a dict with:
          - results: list of book dicts
          - total: total count
          - page: current page
          - pages: total pages
          - query, search_type, scope
        """
        params = {
            "searchtype": search_type,
            "searcharg": query,
            "searchscope": scope,
            "SORT": sort,
        }
        resp = self.session.get(self.SEARCH_URL, params=params, timeout=15)
        data = self._parse_results(resp.text, query, search_type, scope, page)
        if available_only:
            data["results"] = [
                r for r in data["results"]
                if r.get("availability") and any(
                    item["status"] == "Available" for item in r["availability"]
                )
            ]
        return data

    def collapse_search(
        self,
        query: str,
        search_type: str = "X",
        scope: str = "171",
        sort: str = "D",
        available_only: bool = False,
    ) -> dict:
        """
        Search and aggregate all physical copies from all result editions
        into a single flat list, sorted by library, each with an item_id for
        inline reservation.

        Returns a dict with keys: query, search_type, scope, total_results,
        editions_fetched, copies, grouped_copies, collapsed=True.
        """
        results = self.search(query, search_type, scope, sort)
        books = [
            b for b in results["results"]
            if b.get("bib_id") and not b.get("is_browse_entry")
        ]

        def _fetch(book: dict) -> list[dict]:
            try:
                form = self.get_hold_form(book["bib_id"])
                if not form:
                    return []
                out = []
                for copy in form["copies"]:
                    out.append({
                        "library": copy["location"],
                        "edition_title": book["title"],
                        "bib_id": book["bib_id"],
                        "item_id": copy["item_id"],
                        "call_number": copy["call_number"],
                        "status": copy["status"],
                        "notes": copy["notes"],
                        "media_type": book.get("media_type", ""),
                    })
                return out
            except Exception:
                return []

        with ThreadPoolExecutor(max_workers=6) as pool:
            all_lists = list(pool.map(_fetch, books))

        all_copies: list[dict] = []
        for lst in all_lists:
            all_copies.extend(lst)

        # Sort by library name, then available-first within each library
        all_copies.sort(key=lambda c: (c["library"].lower(), c["status"] != "Available"))

        if available_only:
            all_copies = [c for c in all_copies if c["status"] == "Available"]

        # Group by library for easy template rendering
        grouped: dict[str, list] = {}
        for copy in all_copies:
            grouped.setdefault(copy["library"], []).append(copy)
        grouped_copies = list(grouped.items())

        return {
            "query": query,
            "search_type": search_type,
            "scope": scope,
            "total_results": results["total"],
            "editions_fetched": len(books),
            "copies": all_copies,
            "grouped_copies": grouped_copies,
            "collapsed": True,
        }

    def _parse_results(
        self, html: str, query: str, search_type: str, scope: str, page: int
    ) -> dict:
        soup = BeautifulSoup(html, "lxml")

        # Total results count
        total = 0
        header = soup.find("td", class_="browseHeaderData")
        if header:
            m = re.search(r"(\d+)\s+of\s+(\d+)", header.get_text())
            if m:
                total = int(m.group(2))

        # Keyword search returns briefCitRow elements
        brief_rows = soup.find_all("td", class_="briefCitRow")
        if brief_rows:
            books = [b for row in brief_rows if (b := self._parse_brief_row(row))]
        else:
            # Browse list (title / author / subject search)
            books = self._parse_browse_list(soup, search_type, scope)
            if not total and books:
                total = len(books)

        pages = max(1, (total + 11) // 12)

        return {
            "results": books,
            "total": total,
            "page": page,
            "pages": pages,
            "query": query,
            "search_type": search_type,
            "scope": scope,
            "is_browse": bool(not brief_rows and books),
        }

    def _parse_brief_row(self, row) -> dict | None:
        try:
            # Bib ID
            checkbox = row.find("input", type="checkbox")
            bib_id = checkbox["value"] if checkbox else None

            # Media type
            media_div = row.find("div", class_="briefcitMedia")
            media_type = ""
            if media_div:
                img = media_div.find("img")
                if img:
                    media_type = img.get("alt", "")

            # Cover image
            cover_url = ""
            portada_div = row.find("div", class_="brief_portada")
            if portada_div:
                img = portada_div.find("img")
                if img:
                    cover_url = img.get("src", "")

            # Title — first link inside span.titular
            title = ""
            record_url = ""
            titular = row.find("span", class_="titular")
            if titular:
                title_link = titular.find("a")
                if title_link:
                    title = title_link.get_text(strip=True)

            # Build canonical record URL from bib_id
            if bib_id:
                record_url = f"{BASE_URL}/record={bib_id}~S{SCOPE}"

            # Author and publication from text nodes inside div.descript
            # Structure (after removing span.titular):
            #   <br/><br/> Author name <br/> Publication info <br/>
            # Films/media often have no author, just <br/><br/><br/> then pub.
            author = ""
            year = ""
            pub = ""
            descript = row.find("div", class_="descript")
            if descript:
                # Remove the titular span so we only read the plain text lines
                titular_clone = descript.find("span", class_="titular")
                if titular_clone:
                    titular_clone.extract()
                # Also remove rating spans / images
                for el in descript.find_all(["span", "img"]):
                    el.extract()

                # Now collect non-empty text lines
                lines = [
                    t.strip()
                    for t in descript.strings
                    if t.strip() and t.strip() not in ("Rating:", "Request item")
                ]

                for line in lines:
                    # Publication: "City : Publisher, [year]" — identified by " : " separator
                    if " : " in line:
                        pub = line
                        year_m = re.search(r"\[?(\d{4})\]?", line)
                        if year_m:
                            year = year_m.group(1)
                    elif not author and line:
                        # First non-empty line after title → author
                        author = line

            # Availability from bibItems table
            availability = self._parse_availability(row)

            return {
                "bib_id": bib_id,
                "title": title,
                "author": author,
                "year": year,
                "pub": pub,
                "cover_url": cover_url,
                "media_type": media_type,
                "record_url": record_url,
                "availability": availability,
            }
        except Exception:
            return None

    def _parse_availability(self, context) -> list[dict]:
        """Parse availability from a bibItems table near a result row."""
        items = []
        bibitems = None
        # The bibItems table follows the briefCitRow - navigate to parent
        parent = context
        for _ in range(5):
            parent = parent.parent
            if parent is None:
                break
            bibitems = parent.find("table", class_="bibItems")
            if bibitems:
                break

        if not bibitems:
            return items

        for row in bibitems.find_all("tr", class_="bibItemsEntry"):
            cells = row.find_all("td")
            if len(cells) >= 3:
                location = cells[0].get_text(strip=True)
                call_number = cells[1].get_text(strip=True)
                status = cells[2].get_text(strip=True)
                notes = cells[3].get_text(strip=True) if len(cells) > 3 else ""
                items.append({
                    "location": location,
                    "call_number": call_number,
                    "status": status,
                    "notes": notes,
                })
        return items

    def _parse_browse_list(self, soup, search_type: str, scope: str) -> list[dict]:
        """Parse a browse list (title/author/subject search results)."""
        books = []
        type_labels = {
            "t": "Titles", "a": "Authors", "d": "Subjects",
            "i": "ISBN", "c": "Call Number",
        }
        kind = type_labels.get(search_type, "Results")

        for row in soup.find_all("tr", class_="browseEntry"):
            link = row.find("td", class_="browseEntryData")
            count_td = row.find("td", class_="browseEntryEntries")
            if not link:
                continue

            # Skip named anchors — find the link that has an href to a search URL
            a_tag = None
            for a in link.find_all("a"):
                if a.get("href"):
                    a_tag = a
                    break
            if not a_tag:
                continue

            entry_text = a_tag.get_text(strip=True)
            count = count_td.get_text(strip=True) if count_td else "?"
            href = a_tag.get("href", "")
            full_href = (BASE_URL + href) if href.startswith("/") else href

            books.append({
                "bib_id": None,
                "title": entry_text,
                "author": f"{count} item(s)",
                "year": "",
                "pub": kind,
                "cover_url": "",
                "media_type": kind,
                "record_url": full_href,
                "availability": [],
                "is_browse_entry": True,
            })
        return books

    # ------------------------------------------------------------------
    # Book detail
    # ------------------------------------------------------------------

    def get_book(self, bib_id: str) -> dict | None:
        """Fetch a full bibliographic record, including item_ids for inline reserve."""
        url = f"{BASE_URL}/record={bib_id}~S{SCOPE}"
        resp = self.session.get(url, timeout=15)
        if resp.status_code != 200:
            return None
        book = self._parse_book_detail(resp.text, bib_id)

        # Enrich availability with item_ids from the hold form so the template
        # can render inline reserve buttons without a separate page hop.
        hold_data = self.get_hold_form(bib_id)
        if hold_data:
            # Index by a normalised (location, call_number) key
            item_map: dict[tuple, str] = {}
            for copy in hold_data["copies"]:
                key = (copy["location"][:30].lower(), copy["call_number"][:12].lower())
                item_map[key] = copy["item_id"]
            for avail in book["availability"]:
                key = (avail["location"][:30].lower(), avail["call_number"][:12].lower())
                avail["item_id"] = item_map.get(key, "")
        else:
            for avail in book["availability"]:
                avail["item_id"] = ""

        return book

    def _parse_book_detail(self, html: str, bib_id: str) -> dict:
        soup = BeautifulSoup(html, "lxml")

        # Cover image
        cover_url = ""
        fitxa = soup.find("div", class_="fitxa_imatge")
        if fitxa:
            img = fitxa.find("img")
            if img:
                cover_url = img.get("src", "")

        # Parse all bibDetail tables → list of {label, value} pairs
        all_fields: list[dict] = []
        for tbl in soup.find_all("table", class_="bibDetail"):
            inner = tbl.find("table")
            if not inner:
                continue
            current_label = ""
            for row_el in inner.find_all("tr"):
                label_td = row_el.find("td", class_="bibInfoLabel")
                data_td = row_el.find("td", class_="bibInfoData")
                if label_td:
                    current_label = label_td.get_text(strip=True)
                if data_td:
                    val = data_td.get_text(separator=" ", strip=True)
                    if val:
                        all_fields.append({"label": current_label, "value": val})

        # Build a convenient dict of the FIRST occurrence of each label
        fields: dict[str, str] = {}
        for entry in all_fields:
            lbl = entry["label"]
            if lbl and lbl not in fields:
                fields[lbl] = entry["value"]

        # Availability
        availability = []
        for bibitems in soup.find_all("table", class_="bibItems"):
            for row_el in bibitems.find_all("tr", class_="bibItemsEntry"):
                cells = row_el.find_all("td")
                if len(cells) >= 3:
                    availability.append({
                        "location": cells[0].get_text(strip=True),
                        "call_number": cells[1].get_text(strip=True),
                        "status": cells[2].get_text(strip=True),
                        "notes": cells[3].get_text(strip=True) if len(cells) > 3 else "",
                    })

        return {
            "bib_id": bib_id,
            "fields": fields,
            "all_fields": all_fields,
            "cover_url": cover_url,
            "availability": availability,
        }

    # ------------------------------------------------------------------
    # Patron account
    # ------------------------------------------------------------------

    def get_patron_items(self) -> list[dict]:
        """Get currently checked-out items."""
        if not self.patron_id:
            return []
        url = f"{BASE_URL}/patroninfo~S{SCOPE}/{self.patron_id}/items"
        resp = self.session.get(url, timeout=15)
        return self._parse_patron_items(resp.text)

    def _parse_patron_items(self, html: str) -> list[dict]:
        soup = BeautifulSoup(html, "lxml")
        items = []
        # Actual class is 'patFunc', not 'patFuncTable'
        table = soup.find("table", class_="patFunc")
        if not table:
            return items
        for row in table.find_all("tr", class_="patFuncEntry"):
            # Title is in a <th class="patFuncBibTitle">, rest are <td>
            title_th = row.find("th", class_="patFuncBibTitle")
            title = title_th.get_text(strip=True) if title_th else ""
            # Extract bib_id from the link href
            bib_id = ""
            if title_th:
                a = title_th.find("a", href=re.compile(r"/record="))
                if a:
                    m = re.search(r"/record=([^~]+)~", a.get("href", ""))
                    if m:
                        bib_id = m.group(1)

            barcode_td = row.find("td", class_="patFuncBarcode")
            status_td = row.find("td", class_="patFuncStatus")
            callno_td = row.find("td", class_="patFuncCallNo")

            # Due date: main text, renewals in a sub-span
            due_date = ""
            renewed = ""
            if status_td:
                renew_span = status_td.find("span", class_="patFuncRenewCount")
                if renew_span:
                    renewed = renew_span.get_text(strip=True)
                    renew_span.extract()
                due_date = status_td.get_text(strip=True)

            items.append({
                "title": title,
                "bib_id": bib_id,
                "barcode": barcode_td.get_text(strip=True) if barcode_td else "",
                "due_date": due_date,
                "renewed": renewed,
                "call_number": callno_td.get_text(strip=True) if callno_td else "",
            })
        return items

    def get_patron_holds(self) -> list[dict]:
        """Get pending holds/reservations."""
        if not self.patron_id:
            return []
        url = f"{BASE_URL}/patroninfo~S{SCOPE}/{self.patron_id}/holds"
        resp = self.session.get(url, timeout=15)
        return self._parse_patron_holds(resp.text)

    def _parse_patron_holds(self, html: str) -> list[dict]:
        soup = BeautifulSoup(html, "lxml")
        items = []
        # Actual class is 'patFunc'
        table = soup.find("table", class_="patFunc")
        if not table:
            return items
        for row in table.find_all("tr", class_="patFuncEntry"):
            title_th = row.find("th", class_="patFuncBibTitle")
            title = title_th.get_text(strip=True) if title_th else ""
            bib_id = ""
            if title_th:
                a = title_th.find("a", href=re.compile(r"/record="))
                if a:
                    m = re.search(r"/record=([^~]+)~", a.get("href", ""))
                    if m:
                        bib_id = m.group(1)

            status_td = row.find("td", class_="patFuncStatus")
            pickup_td = row.find("td", class_="patFuncPickup")
            cancel_td = row.find("td", class_="patFuncCancel")

            items.append({
                "title": title,
                "bib_id": bib_id,
                "status": status_td.get_text(strip=True) if status_td else "",
                "pickup": pickup_td.get_text(strip=True) if pickup_td else "",
                "cancel_by": cancel_td.get_text(strip=True) if cancel_td else "",
            })
        return items

    # ------------------------------------------------------------------
    # Hold / Reserve
    # ------------------------------------------------------------------

    def get_hold_form(self, bib_id: str) -> dict | None:
        """
        Fetch the hold request page for a bib record.
        Returns a dict with the form URL and a list of copies to choose from.
        """
        url = (
            f"{BASE_URL}/search~S{SCOPE}?"
            f"/.{bib_id}/.{bib_id}/1%2C1%2C1%2CB/request~{bib_id}"
        )
        resp = self.session.get(url, timeout=15)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "lxml")

        form = soup.find("form", method=re.compile(r"post", re.I))
        if not form:
            return None

        # Get patron name/code from hidden inputs (they're pre-filled by the server)
        patron_name = ""
        patron_code = ""
        for inp in form.find_all("input", type="hidden"):
            if inp.get("name") == "name":
                patron_name = inp.get("value", "")
            elif inp.get("name") == "code":
                patron_code = inp.get("value", "")

        # Build list of available copies
        copies = []
        bibitems = form.find("table", class_="bibItems")
        if bibitems:
            for row in bibitems.find_all("tr", class_="bibItemsEntry"):
                radio = row.find("input", type="radio")
                if not radio:
                    continue
                item_id = radio.get("value", "")
                cells = row.find_all("td")
                location = cells[1].get_text(strip=True) if len(cells) > 1 else ""
                call_number = cells[2].get_text(strip=True) if len(cells) > 2 else ""
                status = cells[3].get_text(strip=True) if len(cells) > 3 else ""
                notes = cells[4].get_text(strip=True) if len(cells) > 4 else ""
                # Skip items which cannot be requested
                if "cannot be requested" in notes.lower():
                    continue
                copies.append({
                    "item_id": item_id,
                    "location": location,
                    "call_number": call_number,
                    "status": status,
                    "notes": notes,
                })

        # Get title from page
        title = ""
        main = soup.find("div", class_="pageContentColumn")
        if main:
            # Look for text like "Requesting\nTitle name\n"
            text = main.get_text(separator="\n", strip=True)
            m = re.search(r"Requesting\n(.+)", text)
            if m:
                title = m.group(1).strip()

        return {
            "form_url": url,
            "bib_id": bib_id,
            "title": title,
            "copies": copies,
            "patron_name": patron_name,
            "patron_code": patron_code,
        }

    def place_hold(self, bib_id: str, item_id: str) -> dict:
        """
        POST the hold form to request a specific copy.
        Returns {"success": bool, "message": str}.
        """
        form_url = (
            f"{BASE_URL}/search~S{SCOPE}?"
            f"/.{bib_id}/.{bib_id}/1%2C1%2C1%2CB/request~{bib_id}"
        )
        post_data = {
            "radio": item_id,
            "name": self.patron_name or "",
            "code": self._barcode,
        }
        resp = self.session.post(
            form_url,
            data=post_data,
            headers={"Referer": form_url, "Origin": BASE_URL},
            allow_redirects=True,
            timeout=15,
        )
        soup = BeautifulSoup(resp.text, "lxml")
        # Check for success/failure messages in the page
        main = soup.find("div", class_="pageContentColumn")
        text = main.get_text(strip=True) if main else resp.text[:500]

        if "your hold" in text.lower() or "request" in text.lower() and "success" in text.lower():
            return {"success": True, "message": "Hold placed successfully."}
        if "already" in text.lower():
            return {"success": False, "message": "You already have a hold on this item."}
        # A successful hold typically redirects to the holds list
        if resp.url and "holds" in resp.url:
            return {"success": True, "message": "Hold placed successfully."}
        return {"success": True, "message": "Request submitted."}
