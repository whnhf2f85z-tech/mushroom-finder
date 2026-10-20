"""Charts for docs/VALIDATION.md from validation/results/*.json.

    validation/.venv/bin/python validation/plots.py
"""
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "docs", "validation")
os.makedirs(OUT, exist_ok=True)

NAMES = {
    "chanterelle": "Chanterelle",
    "porcini": "Porcini",
    "winter_chanterelle": "Winter chanterelle",
    "horn_of_plenty": "Horn of plenty",
    "bay_bolete": "Bay bolete",
    "hedgehog": "Hedgehog",
    "honey_fungus": "Honey fungus",
    "parasol": "Parasol",
    "morel": "Morel",
}
BLUE = "#2a78d6"
ORANGE = "#eb6834"
GREY = "#8a8a85"
INK = "#1d231e"
MUTED = "#5b655d"
MONTHS = [(1, "Jan"), (32, "Feb"), (60, "Mar"), (91, "Apr"), (121, "May"), (152, "Jun"), (182, "Jul"), (213, "Aug"), (244, "Sep"), (274, "Oct"), (305, "Nov"), (335, "Dec")]

plt.rcParams.update(
    {
        "font.size": 9,
        "axes.edgecolor": "#cfccc3",
        "axes.labelcolor": MUTED,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.titleweight": "bold",
        "axes.titlesize": 10,
        "figure.dpi": 150,
    }
)


def load(name):
    path = os.path.join(HERE, "results", f"{name}.json")
    return json.load(open(path)) if os.path.exists(path) else None


def month_axis(ax, lo=1, hi=366):
    ticks = [(d, m) for d, m in MONTHS if lo <= d <= hi]
    ax.set_xticks([d for d, _ in ticks])
    ax.set_xticklabels([m for _, m in ticks])
    ax.set_xlim(lo, hi)


def season_scatter(season):
    fig, axes = plt.subplots(3, 3, figsize=(10, 9), sharey=True)
    for ax, (sid, name) in zip(axes.flat, NAMES.items()):
        r = season[sid]
        curve = r["curve"]
        elev = [c[0] for c in curve]
        a = [c[1] for c in curve]
        b = [c[2] for c in curve]
        c_ = [c[3] for c in curve]
        d = [c[4] for c in curve]
        ax.fill_betweenx(elev, a, d, color=GREY, alpha=0.18, lw=0, label="Model season")
        ax.fill_betweenx(elev, b, c_, color=GREY, alpha=0.35, lw=0, label="Model peak")
        pts = r["ch"]["points"]
        if pts:
            ax.scatter([p[0] for p in pts], [p[1] for p in pts], s=10, color=BLUE, alpha=0.75, edgecolor="white", linewidth=0.4, label="Records (CH, precise)")
        spring = sid == "morel"
        month_axis(ax, 32 if spring else 140, 182 if spring else 366)
        ax.set_ylim(250, 1900)
        ax.set_title(f"{name}  (n={r['ch']['n']})", color=INK, loc="left")
    for ax in axes[:, 0]:
        ax.set_ylabel("Elevation (m)")
    handles, labels = axes.flat[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=3, frameon=False)
    fig.suptitle("Record dates by elevation vs. the model's season", x=0.02, ha="left", fontsize=12, fontweight="bold", color=INK)
    fig.tight_layout(rect=(0, 0.04, 1, 0.97))
    fig.savefig(os.path.join(OUT, "season-by-elevation.png"))
    plt.close(fig)


def season_sf(season):
    fig, axes = plt.subplots(3, 3, figsize=(10, 7.5))
    for ax, (sid, name) in zip(axes.flat, NAMES.items()):
        r = season[sid]
        doy = r["sf5km"]["doy"]
        spring = sid == "morel"
        lo, hi = (32, 182) if spring else (140, 366)
        ax.hist(doy, bins=range(lo, hi + 7, 7), color=BLUE, alpha=0.85, edgecolor="white", linewidth=0.5)
        top = ax.get_ylim()[1]
        for k, (elev, colour) in enumerate([(600, ORANGE), (1200, GREY)]):
            c = next(x for x in r["curve"] if x[0] == elev)
            y = top * (1.04 + 0.08 * k)
            ax.plot([c[1], c[4]], [y, y], color=colour, lw=1.5)
            ax.plot([c[2], c[3]], [y, y], color=colour, lw=4, solid_capstyle="round", label=f"Model at {elev} m (thin: season, thick: peak)")
        ax.set_ylim(0, top * 1.2)
        month_axis(ax, lo, hi)
        ax.set_title(f"{name}  (n={r['sf5km']['n']})", color=INK, loc="left")
    axes[0, 0].set_ylabel("Records per week")
    handles, labels = axes.flat[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=2, frameon=False)
    fig.suptitle("SwissFungi records in Zürich + Schwyz by week (all years, all elevations)", x=0.02, ha="left", fontsize=12, fontweight="bold", color=INK)
    fig.tight_layout(rect=(0, 0.05, 1, 0.97))
    fig.savefig(os.path.join(OUT, "season-swissfungi.png"))
    plt.close(fig)


def habitat(h):
    fig, ax = plt.subplots(figsize=(10, 4.2))
    ids = list(NAMES)
    for k, sid in enumerate(ids):
        v = h["hValues"][sid]
        parts = ax.violinplot([v["all"]], positions=[k], widths=0.8, showextrema=False)
        for b in parts["bodies"]:
            b.set_facecolor(GREY)
            b.set_alpha(0.3)
        if v["cases"]:
            ax.scatter([k] * len(v["cases"]), v["cases"], s=16, color=BLUE, edgecolor="white", linewidth=0.5, zorder=3)
        r = h["results"][sid]
        label = f"AUC {r['aucAll']:.2f}" if r["aucAll"] is not None else "no records"
        ax.text(k, 1.07, f"{label}\nn={r['nCells']}", ha="center", va="bottom", fontsize=8, color=MUTED)
    ax.set_xticks(range(len(ids)))
    ax.set_xticklabels([NAMES[i] for i in ids], rotation=20)
    ax.set_ylim(0, 1.25)
    ax.set_ylabel("Habitat score H")
    ax.set_title("Habitat score of squares with records (blue) vs. all forest squares (grey), ZH + SZ, precise records", loc="left", color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "habitat-auc.png"))
    plt.close(fig)


def weather(w):
    fig, ax = plt.subplots(figsize=(10, 4.2))
    ids = list(NAMES)
    for k, sid in enumerate(ids):
        r = w["results"][sid]
        t, p = r["target"], r["placebo"]
        if t["W"] is not None:
            ax.errorbar(k - 0.12, t["W"], yerr=[[t["W"] - t["W_ci"][0]], [t["W_ci"][1] - t["W"]]], fmt="o", color=BLUE, capsize=3, label="Records of the species" if k == 0 else None)
            ax.text(k - 0.12, t["W_ci"][1] + 0.015, f"n={t['n']}", ha="center", fontsize=7, color=MUTED)
        if p["W"] is not None:
            ax.errorbar(k + 0.12, p["W"], yerr=[[p["W"] - p["W_ci"][0]], [p["W_ci"][1] - p["W"]]], fmt="s", color=GREY, capsize=3, label="Placebo: bracket fungi" if k == 0 else None)
    ax.axhline(0.5, color=MUTED, lw=1, ls="--")
    ax.text(-0.45, 0.505, "no signal (50 %)", ha="left", va="bottom", fontsize=8, color=MUTED)
    ax.set_xticks(range(len(ids)))
    ax.set_xticklabels([NAMES[i] for i in ids], rotation=20)
    ax.set_ylabel("Percentile of the record date\namong control dates")
    ax.set_ylim(0.2, 0.85)
    ax.legend(frameon=False, loc="upper left")
    ax.set_title("Weather part of the score on record dates vs. same place, ±30 days, same kind of day (since 2021)", loc="left", color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "weather-case-control.png"))
    plt.close(fig)


# Part B: documented good (+) and poor (−) periods (sources in VALIDATION.md); shared with validation/variants.ts.
DOCUMENTED = {
    int(y): [tuple(p) for p in ps]
    for y, ps in json.load(open(os.path.join(HERE, "data", "documented-periods.json")))["periods"].items()
}
GREEN = "#3c8a4e"


def doy(y, md):
    import datetime as dt
    return dt.date(y, int(md[:2]), int(md[3:])).timetuple().tm_yday


def past_seasons(ps, ticker):
    years = sorted(int(y) for y in ps["years"])
    fig, axes = plt.subplots(len(years), 1, figsize=(10, 1.9 * len(years)), sharex=True)
    for ax, y in zip(axes, years):
        for sign, a, b in DOCUMENTED.get(y, []):
            ax.axvspan(doy(y, a), doy(y, b), color=GREEN if sign == "+" else ORANGE, alpha=0.13, lw=0)
            ax.text((doy(y, a) + doy(y, b)) / 2, 96, "good" if sign == "+" else "poor", ha="center", va="top", fontsize=7, color=GREEN if sign == "+" else ORANGE)
        for kind, color, label in (("spots", BLUE, "14 spots"), ("squares", INK, "30 sample squares")):
            wk = ps["years"][str(y)][kind]
            xs = [doy(int(w[:4]), w[5:]) + 3 for w in wk]
            ax.plot(xs, [v["favourites"] for v in wk.values()], color=color, lw=2 if kind == "spots" else 1.2, ls="-" if kind == "spots" else "--", label=label)
        if ticker:
            for w, v in ticker["weekly"].items():
                if w.startswith(str(y)):
                    x = doy(y, w[5:]) + 3
                    pos = v["reports"] - v["negative"]
                    if pos:
                        ax.plot([x] * pos, [4 + 4 * i for i in range(pos)], "^", color=GREEN, ms=4, ls="none")
                    if v["negative"]:
                        ax.plot([x] * v["negative"], [4 + 4 * (pos + i) for i in range(v["negative"])], "v", color=GREY, ms=4, ls="none")
        ax.set_ylim(0, 100)
        ax.set_ylabel(str(y), rotation=0, ha="right", va="center", fontsize=10, fontweight="bold", color=INK)
        ax.grid(axis="y", color="#e6e3db", lw=0.6)
        month_axis(ax, doy(y, "06-01"), doy(y, "11-15"))
    handles = axes[0].get_legend_handles_labels()[0] + [
        plt.Line2D([], [], marker="^", color=GREEN, ls="none", ms=5),
        plt.Line2D([], [], marker="v", color=GREY, ls="none", ms=5),
        plt.Rectangle((0, 0), 1, 1, color=GREEN, alpha=0.13),
        plt.Rectangle((0, 0), 1, 1, color=ORANGE, alpha=0.13),
    ]
    labels = ["14 spots", "30 sample squares", "Pilz-Ticker report", "Pilz-Ticker: nothing / too dry", "Documented good", "Documented poor"]
    fig.legend(handles, labels, frameon=False, loc="lower center", ncol=6, fontsize=8)
    fig.suptitle("Weekly mean score (best of the default favourites) vs. documented periods and Pilz-Ticker reports", x=0.01, ha="left", fontsize=10, fontweight="bold", color=INK)
    fig.tight_layout(rect=(0, 0.03, 1, 0.98))
    fig.savefig(os.path.join(OUT, "past-seasons.png"))
    plt.close(fig)

    # Season summary: mean score 15 Aug – 31 Oct and share of 'good' days (score ≥ 60) per year.
    fig, ax = plt.subplots(figsize=(7, 3))
    means, goods = [], []
    for y in years:
        wk = {w: v for w, v in ps["years"][str(y)]["spots"].items() if f"{y}-08-15" <= w <= f"{y}-10-31"}
        means.append(sum(v["favourites"] for v in wk.values()) / max(1, len(wk)))
        goods.append(100 * sum(v["good"] for v in wk.values()) / max(1, len(wk)))
    verdict = {2021: "poor", 2022: "record", 2023: "weak", 2024: "good", 2025: "mixed", 2026: "dry Aug, good Sep"}
    ax.bar([f"{y}\ndocumented: {verdict.get(y, '?')}" for y in years], means, color=BLUE, width=0.55)
    for k, (m, g) in enumerate(zip(means, goods)):
        ax.text(k, m + 1, f"{m:.0f}\n({g:.0f} % days ≥ 60)", ha="center", fontsize=7.5, color=MUTED)
    ax.set_ylim(0, max(means) * 1.35)
    ax.set_ylabel("Mean score, 15 Aug – 31 Oct")
    ax.set_title("Model season strength at the 14 spots (2026 until 18 Oct)", loc="left", color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "past-seasons-summary.png"))
    plt.close(fig)


if __name__ == "__main__":
    s = load("season")
    if s:
        season_scatter(s)
        season_sf(s)
    h = load("habitat")
    if h:
        habitat(h)
    w = load("weather")
    if w:
        weather(w)
    ps = load("past-seasons")
    if ps:
        past_seasons(ps, load("ticker"))
    print("Charts written to", os.path.abspath(OUT))
