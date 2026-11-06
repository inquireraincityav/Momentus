# Hygd — Event & Room Schedule

A small Flask app that reads MECS daily resource PDF reports and shows the events on a calendar: rooms, times, contacts, setup and equipment lists, and any room-layout diagrams embedded in the report.

Everything runs locally. There is no external API or cloud service.

## Features

- Upload a PDF in the browser and every event in it is parsed and stored
- Month, week, day and agenda views (FullCalendar)
- Click an event to see its full setup details and layout diagram
- Filters by department, search, and a view grouped by client booking
- Setup checklists and comments on events
- Analytics page (`/analytics`) and a comments report (`/comments/report`)

Supported reports (detected automatically):

- Daily Resources by Space – All Functions
- Daily Resources by Setup Time
- Services by Function Date

## Tech stack

Python 3.10+ · Flask · pdfplumber · SQLite · FullCalendar · Bootstrap

## Project structure

```
app.py          Flask routes (upload, events API, reports)
parser.py       PDF text extraction and event parsing
database.py     SQLite helpers
analytics.py    Semester and department aggregation
templates/      HTML pages
static/         CSS and JavaScript
tests/          pytest tests
```

These are created on first run and are not tracked in git: `events.db` (the database) and `uploads/` (uploaded PDFs, layout images, comment photos).

## Run it locally

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000, click **Upload PDF** and drop in a report.

Optional settings go in a `.env` file (copy `.env.example`). You can also set `PORT` to change the port. Setting `FLASK_DEBUG=1` turns on the debugger, which is for local use only.

To start over, stop the app and delete `events.db` and `uploads/`.

## Tests

```bash
python -m pytest tests
```

## Deploying

`python app.py` is for development only. On a server, run it with Gunicorn (for example `gunicorn -w 2 -b 0.0.0.0:8000 app:app`), optionally behind nginx.

## Security notes

- The app sends a Content-Security-Policy that allows scripts and styles only from the app itself and `cdn.jsdelivr.net`. If you add a library from another CDN, add that CDN to `SECURITY_HEADERS` in `app.py`.
- Never commit `.env`, `events.db` or `uploads/`. They are already in `.gitignore`.
- Check dependencies with `pip-audit -r requirements.txt`.
