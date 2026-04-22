# Disclaimer — Research & Educational Use

## Nature of this project

This repository contains a **personal research and educational project** created to study web scraping techniques, HTTP session handling, and modern web UI design using Python and Flask. It was developed as a school project with no commercial intent or profit motive of any kind.

## What the software does

The software provides a personal, locally-running web interface that:

1. Authenticates with the [aladi.diba.cat](https://aladi.diba.cat) public library catalog using credentials supplied by the operator (their own library card barcode and PIN).
2. Sends search queries to the catalog's public OPAC and presents the results in a reformatted UI.
3. Displays the **operator's own** patron account information (checked-out items, holds).
4. Places hold requests through the standard patron self-service interface, on behalf of the authenticated patron.

## What the software does NOT do

- It does **not** access any other patron's data. Authentication is required, and the server enforces account isolation.
- It does **not** bypass any authentication or authorisation mechanism. All requests are made through the official login endpoint using valid patron credentials.
- It does **not** scrape, copy, redistribute, or republish catalog data in bulk or in any persistent form. Results are fetched on demand and displayed only to the logged-in patron.
- It does **not** store the patron's PIN. Only the session cookies returned by the server after a successful login may be saved locally, solely to avoid repeated credential entry.
- It does **not** modify any catalog data.
- It does **not** communicate with any server other than `aladi.diba.cat`. No analytics, telemetry, or third-party services are involved.
- It is **not** exposed to the public internet. It runs exclusively on `localhost` and is intended for use only on the operator's own machine.

## Intended audience

This software is intended for and tested only by its author, operating with their own valid library account. It is published for **educational and peer-review purposes only** — to illustrate the techniques used and to invite feedback.

## Terms of service

The operator of this software is responsible for ensuring their use complies with the terms of service of [aladi.diba.cat](https://aladi.diba.cat) and all applicable laws. The author makes no representation that use of this software is permitted by those terms.

If you are an administrator of the Aladí service or Innovative Interfaces and have concerns about this project, please open an issue or contact the author directly. This repository will be taken down immediately upon a valid request.

## No warranty

This software is provided "as is", without warranty of any kind. See [LICENSE](LICENSE) for details.

## Responsible disclosure

This project does not exploit any vulnerability. It uses only the public-facing HTTP interface in the same way a web browser would. No credentials, private data, or proprietary software belonging to any third party are included in this repository.
