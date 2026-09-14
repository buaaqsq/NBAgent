#!/usr/bin/env python3
import csv

total = 0.0
flagged = []
with open("invoices.csv", newline="") as f:
    for i, row in enumerate(csv.DictReader(f), start=2):
        amount = (row.get("amount") or "").strip()
        date = (row.get("date") or "").strip()
        desc = (row.get("description") or "").strip()
        if not amount:
            flagged.append((i, date, desc, "missing amount"))
            continue
        try:
            total += float(amount)
        except ValueError:
            flagged.append((i, date, desc, f"bad amount: {amount}"))

print(f"valid_total={total:.2f}")
if flagged:
    for line_no, date, desc, why in flagged:
        print(f"flagged: line {line_no} | {date} | {desc} | {why}")
else:
    print("flagged: none")
