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


# Part C: sanity checks.
def sanity(sn):
    import numpy as np
    from matplotlib.colors import LinearSegmentedColormap

    # Sensitivity: score change when one input changes, per species.
    ids = list(NAMES)
    changes = list(sn["sensitivity"][ids[0]]["changes"])
    m = np.array([[sn["sensitivity"][i]["changes"][c] for i in ids] for c in changes])
    fig, ax = plt.subplots(figsize=(10, 6.2))
    cmap = LinearSegmentedColormap.from_list("loss", ["#b2401f", "#f3c9b5", "#ffffff"])
    ax.imshow(m, cmap=cmap, vmin=-60, vmax=0, aspect="auto")
    for r in range(m.shape[0]):
        for c in range(m.shape[1]):
            v = int(m[r, c])
            ax.text(c, r, "0" if v == 0 else f"{v:+d}", ha="center", va="center", fontsize=8, color="white" if v <= -35 else INK)
    ax.set_xticks(range(len(ids)))
    ax.set_xticklabels([f"{NAMES[i].replace(' ', chr(10), 1)}\n(base {sn['sensitivity'][i]['base']})" for i in ids], fontsize=8)
    ax.xaxis.tick_top()
    ax.set_yticks(range(len(changes)))
    ax.set_yticklabels(changes, fontsize=8)
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.tick_params(length=0)
    ax.set_title("Score change when one input changes (good base day, everything else the same)", loc="left", color=INK, pad=34)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "sensitivity.png"))
    plt.close(fig)

    # Grid score spread per species and day (10th–90th percentile band, median, share ≥ 60).
    g = sn["grid"]
    fig, axes = plt.subplots(3, 3, figsize=(10, 7), sharex=True, sharey=True)
    for ax, sid in zip(axes.flat, ids):
        rows = g["spread"][sid]
        x = list(range(len(rows)))
        ax.fill_between(x, [r["p10"] for r in rows], [r["p90"] for r in rows], color=BLUE, alpha=0.18, lw=0, label="10–90 % of squares")
        ax.plot(x, [r["p50"] for r in rows], color=BLUE, lw=2, label="Median square")
        ax.plot(x, [r["max"] for r in rows], color=INK, lw=1, ls=":", label="Best square")
        fc = [k for k, r in enumerate(rows) if r["source"] == "forecast"]
        if fc:
            ax.axvspan(fc[0] - 0.5, x[-1] + 0.5, color=GREY, alpha=0.12, lw=0)
        ax.set_title(NAMES[sid], loc="left", fontsize=9, color=INK)
        ax.set_ylim(0, 100)
        ax.grid(axis="y", color="#e6e3db", lw=0.6)
        ax.set_xticks([0, len(rows) - 1])
        ax.set_xticklabels([rows[0]["date"][5:], rows[-1]["date"][5:]])
    axes.flat[0].legend(frameon=False, fontsize=7, loc="upper left")
    fig.suptitle(f"Scores of the {sum(sn['grid']['histogram'][ids[0]])} forest squares per day (grey: forecast days)", x=0.01, ha="left", fontsize=10, fontweight="bold", color=INK)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    fig.savefig(os.path.join(OUT, "grid-spread.png"))
    plt.close(fig)

    # One habitat map per species: H of every forest square (1 km, LV95).
    h = sn["habitat"]
    e = np.array(h["e"]) + 0.5  # cell corner in km (LV95) → centre
    n = np.array(h["n"]) + 0.5
    cmap = LinearSegmentedColormap.from_list("hab", ["#f2efe6", "#a9cfa0", "#3c8a4e", "#18452a"])
    for sid in ids:
        H = np.array(h["H"][sid])
        st = h["stats"][sid]
        fig, ax = plt.subplots(figsize=(6.4, 6.8))
        sc = ax.scatter(e, n, c=H, cmap=cmap, vmin=0, vmax=1, marker="s", s=14, lw=0)
        ax.set_aspect("equal")
        ax.set_xticks([])
        ax.set_yticks([])
        for sp in ax.spines.values():
            sp.set_visible(False)
        cb = fig.colorbar(sc, ax=ax, fraction=0.035, pad=0.02)
        cb.set_label("Habitat score H (0–1)", color=MUTED)
        cb.outline.set_visible(False)
        ax.set_title(f"{NAMES[sid]}: habitat score per 1 km forest square", loc="left", color=INK)
        ax.text(0, -0.03, f"Median {st['p50']:.2f}, 10–90 %: {st['p10']:.2f}–{st['p90']:.2f}; {100 * st['above07']:.0f} % of squares ≥ 0.7. Zürich (north) and Schwyz (south).", transform=ax.transAxes, fontsize=7.5, color=MUTED, va="top")
        ax.plot([e.min(), e.min() + 10], [n.min() - 2, n.min() - 2], color=INK, lw=2)
        ax.text(e.min() + 5, n.min() - 3.2, "10 km", ha="center", va="top", fontsize=7, color=INK)
        fig.tight_layout()
        fig.savefig(os.path.join(OUT, f"habitat-map-{sid.replace('_', '-')}.png"))
        plt.close(fig)


# Part C: variant comparison.
def variants(vr):
    r = vr["results"]
    main = ["V1", "V2", "V12", "T1", "T2"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 3.6), gridspec_kw={"width_ratios": [1.3, 1]})
    for k, vid in enumerate(main):
        for off, split, color, lab in ((-0.12, "train", BLUE, "2021–2024 (choice)"), (0.12, "test", GREY, "2025–2026 (check)")):
            lo, hi = r[vid][split]["periodDiffCI"]
            d = r[vid][split]["periodAUC"] - r["V0"][split]["periodAUC"]
            ax1.errorbar(k + off, d, yerr=[[d - lo], [hi - d]], fmt="o", color=color, capsize=3, label=lab if k == 0 else None)
    ax1.axhline(0, color=MUTED, lw=1)
    ax1.axhline(0.05, color=ORANGE, lw=1, ls="--")
    ax1.text(len(main) - 0.5, 0.055, "bar for 'clearly better'", ha="right", va="bottom", fontsize=7.5, color=ORANGE)
    ax1.set_xticks(range(len(main)))
    ax1.set_xticklabels([r[v]["label"].replace(": ", ":\n") for v in main], fontsize=7.5)
    ax1.set_ylabel("Period AUC minus current model")
    ax1.legend(frameon=False, fontsize=7.5, loc="lower left")
    ax1.set_title("All species: documented good vs poor weeks", loc="left", color=INK)

    hv = ["V0", "H1", "H1b", "H2", "H3"]
    for k, vid in enumerate(hv):
        for off, split, color in ((-0.12, "train", BLUE), (0.12, "test", GREY)):
            ax2.plot(k + off, r[vid]["caseControl"]["honey_fungus"][split]["corrected"], "o", color=color, ms=7, label=("2021–2024 (choice)" if split == "train" else "2025–2026 (check)") if k == 0 else None)
    ax2.legend(frameon=False, fontsize=7.5, loc="upper right")
    ax2.axhline(0.5, color=MUTED, lw=1, ls="--")
    ax2.set_xticks(range(len(hv)))
    ax2.set_xticklabels(["Current", "3a: rain\n10–20 d", "3a, same\nrain/day", "3b: needs\ncooling", "3a + 3b"], fontsize=7.5)
    ax2.set_ylim(0.25, 0.8)
    ax2.set_ylabel("Record-date percentile\nminus placebo (+0.5)")
    ax2.set_title("Honey fungus: weather on record dates", loc="left", color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "variants.png"))
    plt.close(fig)


# Part D: MeteoSwiss stations.
def stations(st):
    import numpy as np

    rows = [s for s in st["stations"] if s["rain"]]
    fig, axes = plt.subplots(2, 2, figsize=(10, 7))
    nets = [("automatic station", BLUE, "o"), ("automatic rain gauge", ORANGE, "s"), ("manual rain gauge", GREY, "^")]
    ax = axes[0, 0]
    for net, color, marker in nets:
        sel = [s for s in rows if s["network"] == net]
        ax.scatter([s["elevation"] for s in sel], [s["rain"]["point"]["totalModel"] / s["rain"]["point"]["totalMeasured"] for s in sel], color=color, marker=marker, s=26, label=net, zorder=3)
    ax.axhline(1, color=MUTED, lw=1)
    x = np.array([s["elevation"] for s in rows], float)
    y = np.array([s["rain"]["point"]["totalModel"] / s["rain"]["point"]["totalMeasured"] for s in rows])
    k, b = np.polyfit(x, y, 1)
    xs = np.array([x.min(), x.max()])
    ax.plot(xs, k * xs + b, color=INK, lw=1, ls="--")
    ax.text(xs[1], k * xs[1] + b + 0.02, f"+{100 * k * 500:.0f} % per 500 m", ha="right", fontsize=7.5, color=INK)
    ax.set_xlabel("Station elevation (m)")
    ax.set_ylabel("Rain total, app weather ÷ measured")
    ax.legend(frameon=False, fontsize=7, loc="upper left")
    ax.set_title("Rain total (Apr–Nov 2025, Jan–Oct 2026)", loc="left", color=INK)

    ax = axes[0, 1]
    for i, (key, lab, color) in enumerate((("dailyR", "daily", GREY), ("sum11", "11-day sums", BLUE), ("sum60", "60-day sums", INK))):
        v = [s["rain"]["point"][key] if key == "dailyR" else s["rain"]["point"][key]["r"] for s in rows]
        ax.scatter(np.full(len(v), i) + (np.random.default_rng(1).random(len(v)) - 0.5) * 0.3, v, color=color, s=14, alpha=0.8)
        ax.plot([i - 0.25, i + 0.25], [np.median(v)] * 2, color=INK, lw=2)
        ax.text(i + 0.3, np.median(v), f"{np.median(v):.2f}", va="center", fontsize=8, color=INK)
    ax.set_xticks([0, 1, 2])
    ax.set_xticklabels(["Daily rain", "11-day sums\n(the rain window)", "60-day sums\n(dry-spell factor)"], fontsize=8)
    ax.set_ylim(0.5, 1.0)
    ax.set_ylabel("Correlation with measured rain")
    ax.set_title("How well the rain timing matches (50 stations)", loc="left", color=INK)

    ax = axes[1, 0]
    t = [s for s in st["stations"] if s["temperature"] and s["temperature"]["point"]]
    t.sort(key=lambda s: s["elevation"])
    yy = range(len(t))
    ax.barh(list(yy), [s["temperature"]["point"]["bias"] for s in t], color=BLUE, height=0.4, label="Daily mean")
    ax.barh([i + 0.4 for i in yy], [s["temperature"]["point"]["minBias"] for s in t], color=ORANGE, height=0.4, label="Night minimum")
    ax.set_yticks([i + 0.2 for i in yy])
    ax.set_yticklabels([f"{s['name'][:18]} ({s['elevation']} m)" for s in t], fontsize=7)
    ax.axvline(0, color=MUTED, lw=1)
    ax.set_xlabel("App temperature minus measured (°C)")
    ax.legend(frameon=False, fontsize=7, loc="lower right")
    ax.set_title("Temperature bias (13 automatic stations)", loc="left", color=INK)

    ax = axes[1, 1]
    v = sorted(s["scoreImpact"]["meanAbsDiff"] for s in rows)
    ax.hist([s["scoreImpact"]["meanAbsDiff"] for s in rows], bins=np.arange(1.5, 6.01, 0.5), color=BLUE, rwidth=0.85)
    ax.set_xlabel("Mean score change with measured weather (points)")
    ax.set_ylabel("Stations")
    med = np.median(v)
    ax.axvline(med, color=INK, lw=1, ls="--")
    ax.text(med + 0.05, ax.get_ylim()[1] * 0.92, f"median {med:.1f}", fontsize=8, color=INK)
    ax.set_title("Effect on the map score (Jun–Nov)", loc="left", color=INK)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "stations.png"))
    plt.close(fig)


# Part D: the 30 squares on the official map (NFI forest mix over the swisstopo map), with the app's values.
def squares(sq):
    from PIL import Image

    rows = sq["squares"]
    fig, axes = plt.subplots(5, 6, figsize=(12, 13))
    for ax, r in zip(axes.flat, rows):
        path = os.path.join(HERE, "cache", "squares", f"wms_{r['id']}.png")
        if os.path.exists(path):
            ax.imshow(Image.open(path))
        ax.set_xticks([])
        ax.set_yticks([])
        a = r["app"]
        ax.set_title(f"{r['canton']} {r['id'].replace('_', '/')} · {r['elevation']} m", fontsize=7.5, color=INK, loc="left")
        ax.set_xlabel(
            f"cover {a['forest']} % (BFS {r['arealstatistik']['forestPct']} %)\nconifers {a['conifer']} % (natural {r['naturalConiferPct'] if r['naturalConiferPct'] is not None else '–'} %)\npH {a['ph']} ({r['ph']['siteType9']}, geology {r['ph']['geology9']})",
            fontsize=6.5,
            color=MUTED,
        )
    fig.suptitle("30 random squares on the official NFI forest-mix map (dark blue = conifer, green = broadleaf) with the app's values", x=0.01, ha="left", fontsize=10, fontweight="bold", color=INK)
    fig.tight_layout(rect=(0, 0, 1, 0.98))
    fig.savefig(os.path.join(OUT, "squares.png"), dpi=110)
    plt.close(fig)


# Host trees vs conifer share: habitat maps side by side.
def hosts(hs):
    import numpy as np
    from matplotlib.colors import LinearSegmentedColormap

    cmap = LinearSegmentedColormap.from_list("hab", ["#f2efe6", "#a9cfa0", "#3c8a4e", "#18452a"])
    h = hs["habitat"]
    e = np.array(h["e"]) + 0.5
    n = np.array(h["n"]) + 0.5
    for sid in NAMES:
        r = hs["results"][sid]
        old = np.array(sn_H_current(sid))
        new = np.array(h["H"][sid])
        fig, axes = plt.subplots(1, 2, figsize=(9.6, 5.6))
        for ax, H, title, res in ((axes[0], old, "Current: conifer share", r["current"]), (axes[1], new, "Proposed: host trees", r["hostTrees"])):
            ax.scatter(e, n, c=H, cmap=cmap, vmin=0, vmax=1, marker="s", s=7, lw=0)
            ax.set_aspect("equal")
            ax.set_xticks([])
            ax.set_yticks([])
            for sp in ax.spines.values():
                sp.set_visible(False)
            sp_ = res["spread"]
            ax.set_title(title, loc="left", color=INK, fontsize=9)
            ax.text(0, -0.02, f"H 10–90 %: {sp_['p10']:.2f}–{sp_['p90']:.2f}; ≥ 0.7: {100 * sp_['above07']:.0f} %", transform=ax.transAxes, fontsize=7.5, color=MUTED, va="top")
        fig.suptitle(f"{NAMES[sid]}: habitat score per square", x=0.01, ha="left", fontsize=10, fontweight="bold", color=INK)
        fig.tight_layout(rect=(0, 0, 1, 0.95))
        fig.savefig(os.path.join(OUT, f"habitat-hosts-{sid.replace('_', '-')}.png"))
        plt.close(fig)


def sn_H_current(sid):
    return load("sanity")["habitat"]["H"][sid]


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
    sn = load("sanity")
    if sn:
        sanity(sn)
    vr = load("variants")
    if vr:
        variants(vr)
    st = load("stations")
    if st:
        stations(st)
    sq = load("squares")
    if sq:
        squares(sq)
    hs = load("hosts")
    if hs and load("sanity"):
        hosts(hs)
    print("Charts written to", os.path.abspath(OUT))
