"""Build fuel_poland_monthly.csv from EC / fuel-prices.eu bundled data."""
import json
from pathlib import Path

import pandas as pd
import requests

OUT = Path(__file__).resolve().parents[1] / "data" / "processed" / "fuel_poland_monthly.csv"


def main() -> None:
    rows: list[dict] = []
    snap = Path(__file__).resolve().parents[2] / "barrel-to-pump" / "snapshot.js"
    if snap.exists():
        raw = snap.read_text(encoding="utf-8").split("=", 1)[1].rstrip(";\n")
        data = json.loads(raw)
        pb = data["series"]["pb95WithTax"]["points"]
        di = data["series"]["dieselWithTax"]["points"]
        for p, d in zip(pb, di):
            rows.append({
                "date": f"{p['year']}-{p['month']:02d}-01",
                "pb95_eur_l": p["value"],
                "diesel_eur_l": d["value"],
            })
    else:
        txt = requests.get("https://www.fuel-prices.eu/Poland/llms-full.txt", timeout=30).text
        import re
        for line in txt.splitlines():
            m = re.match(r"(\d{4}-\d{2}-\d{2})\s+€\s*([\d.]+)\s+€\s*([\d.]+)", line.strip())
            if not m:
                continue
            dt = pd.to_datetime(m.group(1))
            rows.append({"date": dt.replace(day=1), "pb95_eur_l": float(m.group(2)), "diesel_eur_l": float(m.group(3))})
    df = pd.DataFrame(rows).drop_duplicates("date").sort_values("date")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print("Saved", len(df), "rows to", OUT)


if __name__ == "__main__":
    main()
