#!/usr/bin/env python3
"""
Seed the student dashboard's 2027 teaching schedule prompts.

Two prompt keys are written, mirroring the 2026 pair (controlTitleSchedule / schedule):

  * dashboard-controlTitleSchedule2027 - the button title. Copied from the 2026 title in
    every language it exists in with the year swapped, so existing translations carry over.
  * dashboard-schedule2027 - the schedule body, as HTML. Built here from one structured
    copy of the published 2027 schedule and rendered per language, so dates, weekdays and
    the HTML structure are consistent in every language. Languages: English, French,
    Spanish, Portuguese, German, Italian, Czech (the languages the 2026 body exists in).

When the published schedule changes, edit SCHEDULE below and re-run with --overwrite
--only schedule2027.

This writes to the prompts table only. To make the dashboard see the prompts, refresh
the cache:

    python utils/refresh_prompts_student_dashboard_cache.py --aid dashboard --tier 1 --prompt schedule2027
    python utils/refresh_prompts_student_dashboard_cache.py --aid dashboard --tier 1 --prompt controlTitleSchedule2027

Usage:
    python utils/add_schedule_2027_prompts.py --profile slsupport --dryrun
    python utils/add_schedule_2027_prompts.py --profile slsupport
"""

import argparse
import datetime
import os

import boto3

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DEFAULT_PROMPTS_TABLE = os.environ.get("DYNAMODB_TABLE_PROMPTS", "csf.prompts")
DASHBOARD_AID = "dashboard"
YEAR = 2027
TITLE_SOURCE = "controlTitleSchedule"
TITLE_YEAR_FROM = "2026"

# ---------------------------------------------------------------------------------------
# The schedule. One entry per month heading; each event is
#   (start, end, label_key, label_args, with_weekdays[, children])
# start/end are (month, day); end is None for a single day. Events appear under the month
# the published page lists them in (so an event spanning two months can sit under either).
# ---------------------------------------------------------------------------------------
SCHEDULE = [
    (1, [
        ((1, 10), None, "ngondro_day", (), True),
        ((1, 31), None, "don_days", (), True),
    ]),
    (2, [
        ((2, 14), None, "losar_address", (), True),
        ((2, 27), (2, 28), "maha_weekend", (1,), True),
    ]),
    (3, [
        ((3, 9), (3, 16), "maha_pilgrimage", (), False),
        ((3, 17), (3, 26), "vaj_pilgrimage", (), False),
        ((3, 27), (4, 14), "nepal_intensive", (), False),
    ]),
    (4, [
        ((4, 3), (4, 4), "vaj_weekend", (1,), True),
        ((4, 24), (4, 25), "maha_weekend", (2,), True),
    ]),
    (5, [
        ((5, 15), (5, 16), "vaj_weekend_amitayus", (2,), True),
        ((5, 22), (5, 23), "maha_weekend", (3,), True),
    ]),
    (6, [
        ((6, 5), (6, 6), "vaj_weekend", (3,), True),
        ((6, 16), (6, 20), "maha_online_retreat", (), True),
    ]),
    (7, [
        ((7, 9), (7, 18), "in_person_vermont", (), False, [
            ((7, 9), (7, 11), "maha_retreat", (), True),
            ((7, 12), (7, 15), "vaj_retreat_n", (1,), True),
            ((7, 16), (7, 18), "vaj_retreat_n", (2,), True),
        ]),
    ]),
    (8, [
        ((8, 16), (8, 27), "in_person_switzerland", (), False, [
            ((8, 16), (8, 21), "maha_retreat", (), True),
            ((8, 22), (8, 27), "vaj_retreat", (), True),
        ]),
    ]),
    (9, [
        ((9, 11), (9, 12), "vaj_weekend", (4,), True),
        ((9, 18), (9, 19), "maha_weekend", (4,), True),
    ]),
    (10, [
        ((9, 29), (10, 3), "vaj_online_retreat", (), True),
        ((10, 23), (10, 24), "maha_weekend", (5,), True),
        ((10, 31), None, "guided_meditation", (), True),
    ]),
    (11, [
        ((11, 13), (11, 14), "vaj_weekend", (5,), True),
        ((11, 20), (11, 21), "maha_weekend", (6,), True),
    ]),
    (12, [
        ((12, 4), (12, 5), "vaj_weekend", (6,), True),
        ((12, 11), (12, 12), "buddha_sadhana", (), True),
    ]),
]

# ---------------------------------------------------------------------------------------
# Languages. months_gen is the form used inside a date ("10 janvier"); months is the
# heading form. Date patterns:
#   single:  weekday + date          range: weekdays + date range
#   cross-month ranges repeat the month on both sides.
# ---------------------------------------------------------------------------------------
LANGUAGES = {
    "English": {
        "months": ["January", "February", "March", "April", "May", "June", "July",
                   "August", "September", "October", "November", "December"],
        "weekdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        "day": lambda m, d: f"{m} {d}",
        "range_same": lambda m, d1, d2: f"{m} {d1}–{d2}",
        "wd_sep": ", ",
        "labels": {
            "ngondro_day": "Ngondro Practice Day with Sakyong Rinpoche (Open to all current Vajrayana students)",
            "don_days": "Vajrayana Don Days Practice",
            "losar_address": "Losar Address",
            "maha_weekend": "Mahayana Series Weekend {0}",
            "vaj_weekend": "Vajrayana Series Weekend {0}",
            "vaj_weekend_amitayus": "Vajrayana Series Weekend {0} (Amitayus Intensive, 2 full teaching days)",
            "maha_pilgrimage": "Mahayana Pilgrimage",
            "vaj_pilgrimage": "Vajrayana Pilgrimage",
            "nepal_intensive": "Nepal Retreat Intensive",
            "maha_online_retreat": "Mahayana Online Retreat",
            "vaj_online_retreat": "Vajrayana Online Retreat",
            "in_person_vermont": "In-Person Events Vermont",
            "in_person_switzerland": "In-Person Events Switzerland",
            "maha_retreat": "Mahayana Retreat",
            "vaj_retreat": "Vajrayana Retreat",
            "vaj_retreat_n": "Vajrayana Retreat {0}",
            "guided_meditation": "Guided Meditation Practice with Sakyong Mipham Rinpoche (Open to Everyone)",
            "buddha_sadhana": "Buddha Sadhana Teaching and Practice Weekend (two full teaching days)",
        },
    },
    "French": {
        "months": ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
                   "août", "septembre", "octobre", "novembre", "décembre"],
        "weekdays": ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
        "day": lambda m, d: f"{d} {m}",
        "range_same": lambda m, d1, d2: f"{d1}–{d2} {m}",
        "wd_sep": " ",
        "colon": "\u00a0:",  # French puts a (non-breaking) space before a colon
        "labels": {
            "ngondro_day": "Journée d'entraînement au Ngondro avec Sakyong Rinpoché (ouverte à tous les étudiants actuels du Vajrayana)",
            "don_days": "Pratique des Vajrayana Don Days",
            "losar_address": "Allocution de Losar",
            "maha_weekend": "Week-end {0} de la série Mahayana",
            "vaj_weekend": "Week-end {0} de la série Vajrayana",
            "vaj_weekend_amitayus": "Week-end {0} de la série Vajrayana (intensif Amitayus, 2 jours complets d'enseignement)",
            "maha_pilgrimage": "Pèlerinage du Mahayana",
            "vaj_pilgrimage": "Pèlerinage du Vajrayana",
            "nepal_intensive": "Retraite intensive au Népal",
            "maha_online_retreat": "Retraite en ligne du Mahayana",
            "vaj_online_retreat": "Retraite en ligne du Vajrayana",
            "in_person_vermont": "Événements en présentiel au Vermont",
            "in_person_switzerland": "Événements en présentiel en Suisse",
            "maha_retreat": "Retraite Mahayana",
            "vaj_retreat": "Retraite Vajrayana",
            "vaj_retreat_n": "Retraite Vajrayana {0}",
            "guided_meditation": "Pratique de méditation guidée avec Sakyong Mipham Rinpoché (ouverte à tous)",
            "buddha_sadhana": "Week-end d'enseignement et de pratique de la Sadhana de Bouddha (deux jours complets d'enseignement)",
        },
    },
    "Spanish": {
        "months": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                   "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        "weekdays": ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
        "day": lambda m, d: f"{d} de {m}",
        "range_same": lambda m, d1, d2: f"{d1}–{d2} de {m}",
        "wd_sep": ", ",
        "labels": {
            "ngondro_day": "Día de práctica de Ngondro con Sakyong Rinpoche (abierto a todos los estudiantes actuales de Vajrayana)",
            "don_days": "Práctica de los Don Days del Vajrayana",
            "losar_address": "Discurso de Losar",
            "maha_weekend": "Fin de semana {0} de la serie Mahayana",
            "vaj_weekend": "Fin de semana {0} de la serie Vajrayana",
            "vaj_weekend_amitayus": "Fin de semana {0} de la serie Vajrayana (intensivo de Amitayus, 2 días completos de enseñanza)",
            "maha_pilgrimage": "Peregrinación Mahayana",
            "vaj_pilgrimage": "Peregrinación Vajrayana",
            "nepal_intensive": "Retiro intensivo en Nepal",
            "maha_online_retreat": "Retiro Mahayana en línea",
            "vaj_online_retreat": "Retiro Vajrayana en línea",
            "in_person_vermont": "Eventos presenciales en Vermont",
            "in_person_switzerland": "Eventos presenciales en Suiza",
            "maha_retreat": "Retiro Mahayana",
            "vaj_retreat": "Retiro Vajrayana",
            "vaj_retreat_n": "Retiro Vajrayana {0}",
            "guided_meditation": "Práctica de meditación guiada con Sakyong Mipham Rinpoche (abierta a todos)",
            "buddha_sadhana": "Fin de semana de enseñanza y práctica de la sadhana de Buda (dos días completos de enseñanza)",
        },
    },
    "Portuguese": {
        "months": ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
                   "agosto", "setembro", "outubro", "novembro", "dezembro"],
        "weekdays": ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
                     "sexta-feira", "sábado", "domingo"],
        "day": lambda m, d: f"{d} de {m}",
        "range_same": lambda m, d1, d2: f"{d1} a {d2} de {m}",
        "wd_sep": ", ",
        "labels": {
            "ngondro_day": "Dia de prática de Ngondro com Sakyong Rinpoche (aberto a todos os alunos atuais do Vajrayana)",
            "don_days": "Prática do Vajrayana Don Days",
            "losar_address": "Discurso do Losar",
            "maha_weekend": "Fim de semana {0} da série Mahayana",
            "vaj_weekend": "Fim de semana {0} da série Vajrayana",
            "vaj_weekend_amitayus": "Fim de semana {0} da série Vajrayana (Amitayus Intensive, 2 dias completos de ensino)",
            "maha_pilgrimage": "Peregrinação Mahayana",
            "vaj_pilgrimage": "Peregrinação Vajrayana",
            "nepal_intensive": "Retiro Intensivo no Nepal",
            "maha_online_retreat": "Retiro online Mahayana",
            "vaj_online_retreat": "Retiro online Vajrayana",
            "in_person_vermont": "Eventos presenciais em Vermont",
            "in_person_switzerland": "Eventos presenciais na Suíça",
            "maha_retreat": "Retiro Mahayana",
            "vaj_retreat": "Retiro Vajrayana",
            "vaj_retreat_n": "Retiro Vajrayana {0}",
            "guided_meditation": "Prática de meditação guiada com Sakyong Mipham Rinpoche (aberta a todos)",
            "buddha_sadhana": "Fim de semana de ensino e prática de Buda Sadhana (dois dias completos de ensino)",
        },
    },
    "German": {
        "months": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
                   "August", "September", "Oktober", "November", "Dezember"],
        "weekdays": ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
        "day": lambda m, d: f"{d}. {m}",
        "range_same": lambda m, d1, d2: f"{d1}.–{d2}. {m}",
        "wd_sep": ", ",
        "labels": {
            "ngondro_day": "Ngondro-Praxistag mit Sakyong Rinpoche (offen für alle aktuellen Vajrayana-Schüler)",
            "don_days": "Vajrayana-Don-Days-Praxis",
            "losar_address": "Losar-Ansprache",
            "maha_weekend": "Wochenende {0} der Mahayana-Serie",
            "vaj_weekend": "Wochenende {0} der Vajrayana-Serie",
            "vaj_weekend_amitayus": "Wochenende {0} der Vajrayana-Serie (Amitayus-Intensiv, 2 volle Unterrichtstage)",
            "maha_pilgrimage": "Mahayana-Pilgerreise",
            "vaj_pilgrimage": "Vajrayana-Pilgerreise",
            "nepal_intensive": "Intensiv-Retreat in Nepal",
            "maha_online_retreat": "Mahayana-Online-Retreat",
            "vaj_online_retreat": "Vajrayana-Online-Retreat",
            "in_person_vermont": "Präsenzveranstaltungen in Vermont",
            "in_person_switzerland": "Präsenzveranstaltungen in der Schweiz",
            "maha_retreat": "Mahayana-Retreat",
            "vaj_retreat": "Vajrayana-Retreat",
            "vaj_retreat_n": "Vajrayana-Retreat {0}",
            "guided_meditation": "Geführte Meditationspraxis mit Sakyong Mipham Rinpoche (offen für alle)",
            "buddha_sadhana": "Wochenende zum Lehren und Üben der Buddha-Sadhana (zwei volle Unterrichtstage)",
        },
    },
    "Italian": {
        "months": ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
                   "agosto", "settembre", "ottobre", "novembre", "dicembre"],
        "weekdays": ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"],
        "day": lambda m, d: f"{d} {m}",
        "range_same": lambda m, d1, d2: f"{d1}–{d2} {m}",
        "wd_sep": " ",
        "labels": {
            "ngondro_day": "Giornata di pratica del Ngondro con Sakyong Rinpoche (aperta a tutti gli studenti Vajrayana attuali)",
            "don_days": "Pratica dei Vajrayana Don Days",
            "losar_address": "Discorso di Losar",
            "maha_weekend": "Fine settimana {0} della serie Mahayana",
            "vaj_weekend": "Fine settimana {0} della serie Vajrayana",
            "vaj_weekend_amitayus": "Fine settimana {0} della serie Vajrayana (Amitayus Intensive, 2 giorni completi di insegnamento)",
            "maha_pilgrimage": "Pellegrinaggio Mahayana",
            "vaj_pilgrimage": "Pellegrinaggio Vajrayana",
            "nepal_intensive": "Ritiro intensivo in Nepal",
            "maha_online_retreat": "Ritiro online Mahayana",
            "vaj_online_retreat": "Ritiro online Vajrayana",
            "in_person_vermont": "Eventi in presenza in Vermont",
            "in_person_switzerland": "Eventi in presenza in Svizzera",
            "maha_retreat": "Ritiro Mahayana",
            "vaj_retreat": "Ritiro Vajrayana",
            "vaj_retreat_n": "Ritiro Vajrayana {0}",
            "guided_meditation": "Pratica di meditazione guidata con Sakyong Mipham Rinpoche (aperta a tutti)",
            "buddha_sadhana": "Fine settimana di insegnamento e pratica del Buddha Sadhana (due giorni completi di insegnamento)",
        },
    },
    "Czech": {
        "months": ["leden", "únor", "březen", "duben", "květen", "červen", "červenec",
                   "srpen", "září", "říjen", "listopad", "prosinec"],
        # Inside a date Czech uses the genitive ("10. ledna")
        "months_gen": ["ledna", "února", "března", "dubna", "května", "června", "července",
                       "srpna", "září", "října", "listopadu", "prosince"],
        "weekdays": ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"],
        "day": lambda m, d: f"{d}. {m}",
        "range_same": lambda m, d1, d2: f"{d1}.–{d2}. {m}",
        "wd_sep": " ",
        "labels": {
            "ngondro_day": "Cvičný den Ngondro se Sakyong Rinpočhem (otevřeno všem současným studentům Vajrayany)",
            "don_days": "Praxe Vajrayana Don Days",
            "losar_address": "Projev k Losaru",
            "maha_weekend": "{0}. víkend série Mahayana",
            "vaj_weekend": "{0}. víkend série Vajrayana",
            "vaj_weekend_amitayus": "{0}. víkend série Vajrayana (intenzivní kurz Amitayus, 2 celé dny výuky)",
            "maha_pilgrimage": "Mahayanová pouť",
            "vaj_pilgrimage": "Vajrayanová pouť",
            "nepal_intensive": "Intenzivní retreat v Nepálu",
            "maha_online_retreat": "Mahayana online retreat",
            "vaj_online_retreat": "Vajrayana online retreat",
            "in_person_vermont": "Akce s osobní účastí ve Vermontu",
            "in_person_switzerland": "Akce s osobní účastí ve Švýcarsku",
            "maha_retreat": "Mahayana retreat",
            "vaj_retreat": "Vajrayana retreat",
            "vaj_retreat_n": "Vajrayana retreat {0}",
            "guided_meditation": "Meditační cvičení s průvodcem se Sakyong Mipham Rinpočhem (otevřeno všem)",
            "buddha_sadhana": "Víkend výuky a praxe Buddha Sadhany (dva celé dny výuky)",
        },
    },
}


def format_dates(lang, start, end, with_weekdays):
    """Date text for one event, e.g. 'Saturday–Sunday, February 27–28'."""
    months = lang.get("months_gen", lang["months"])
    month = lambda n: months[n - 1]
    (m1, d1) = start
    day = lang["day"]

    def weekday(m, d):
        return lang["weekdays"][datetime.date(YEAR, m, d).weekday()]

    if end is None:
        text = day(month(m1), d1)
        wds = weekday(m1, d1)
    else:
        (m2, d2) = end
        if m1 == m2:
            text = lang["range_same"](month(m1), d1, d2)
        else:
            text = f"{day(month(m1), d1)} – {day(month(m2), d2)}"
        wds = f"{weekday(m1, d1)}–{weekday(m2, d2)}"

    if not with_weekdays:
        return text[0].upper() + text[1:] if text[0].isalpha() else text
    wds = wds[0].upper() + wds[1:]
    return f"{wds}{lang['wd_sep']}{text}"


def render_event(lang, event, indent):
    start, end, key, args, with_weekdays = event[:5]
    children = event[5] if len(event) > 5 else []
    pad = "  " * indent
    dates = format_dates(lang, start, end, with_weekdays)
    label = lang["labels"][key].format(*args)
    out = [f"{pad}<li><strong>{dates}{lang.get('colon', ':')}</strong> {label}"]
    if children:
        out.append(f"{pad}  <ul>")
        out.extend(render_event(lang, child, indent + 2) for child in children)
        out.append(f"{pad}  </ul>")
        out.append(f"{pad}</li>")
        return "\n".join(out)
    return out[0] + "</li>"


def render_schedule(language):
    lang = LANGUAGES[language]
    parts = []
    for month, events in SCHEDULE:
        heading = lang["months"][month - 1]
        parts.append(f"<h2>{heading}</h2>")
        parts.append("<ul>")
        parts.extend(render_event(lang, event, 1) for event in events)
        parts.append("</ul>")
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def put_prompt(table, name, language, text, dryrun, overwrite):
    key = f"{DASHBOARD_AID}-{name}"
    existing = table.get_item(Key={"prompt": key, "language": language}).get("Item")
    if existing and not overwrite:
        print(f"  skip   {key} [{language}]  (exists; use --overwrite to replace)")
        return 0
    if dryrun:
        print(f"  WOULD  {key} [{language}]  ({len(text)} chars)")
        return 1
    table.put_item(Item={
        "prompt": key,
        "language": language,
        "aid": DASHBOARD_AID,
        "text": text,
    })
    print(f"  wrote  {key} [{language}]")
    return 1


def collect_title_rows(table):
    """The 2026 schedule title in every language it exists in, as {language: text}."""
    titles = {}
    key = f"{DASHBOARD_AID}-{TITLE_SOURCE}"
    from boto3.dynamodb.conditions import Attr
    kwargs = {"FilterExpression": Attr("prompt").eq(key)}
    while True:
        response = table.scan(**kwargs)
        for item in response.get("Items", []):
            titles[item["language"]] = item["text"]
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return titles


def main():
    parser = argparse.ArgumentParser(
        description="Seed the student dashboard 2027 schedule prompts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Usage:")[-1],
    )
    parser.add_argument("--table", default=DEFAULT_PROMPTS_TABLE,
                        help=f"Prompts table (default {DEFAULT_PROMPTS_TABLE})")
    parser.add_argument("--profile", help="AWS profile, e.g. slsupport")
    parser.add_argument("--region", default=AWS_REGION)
    parser.add_argument("--overwrite", action="store_true",
                        help="Replace prompts that already exist (default: leave them alone)")
    parser.add_argument("--only", metavar="NAME", action="append",
                        choices=[f"controlTitleSchedule{YEAR}", f"schedule{YEAR}"],
                        help="Restrict to these prompt names")
    parser.add_argument("--print", dest="print_language", metavar="LANGUAGE",
                        help="Print the rendered schedule HTML for one language and exit "
                             "(no AWS access needed)")
    parser.add_argument("--dryrun", action="store_true",
                        help="Show what would be written without writing")
    args = parser.parse_args()

    if args.print_language:
        print(render_schedule(args.print_language))
        return

    session = (boto3.Session(profile_name=args.profile, region_name=args.region)
               if args.profile else boto3.Session(region_name=args.region))
    table = session.resource("dynamodb").Table(args.table)

    print(f"Prompts table: {args.table}{'  (DRYRUN)' if args.dryrun else ''}\n")
    written = 0

    title_name = f"controlTitleSchedule{YEAR}"
    if not args.only or title_name in args.only:
        print("Button titles, carried over from the 2026 title in every language:")
        titles = collect_title_rows(table)
        if not titles:
            print(f"  none found - no {DASHBOARD_AID}-{TITLE_SOURCE} prompts in {args.table}")
        for language, text in sorted(titles.items()):
            written += put_prompt(table, title_name, language,
                                  text.replace(TITLE_YEAR_FROM, str(YEAR)),
                                  args.dryrun, args.overwrite)

    body_name = f"schedule{YEAR}"
    if not args.only or body_name in args.only:
        print("\nSchedule bodies:")
        for language in LANGUAGES:
            written += put_prompt(table, body_name, language, render_schedule(language),
                                  args.dryrun, args.overwrite)

    print(f"\n{written} prompt row(s) {'would be ' if args.dryrun else ''}written.")
    if not args.dryrun and written:
        print("\nNow refresh the dashboard prompt cache so the dashboard can see them:")
        for name in (body_name, title_name):
            print(f"  python utils/refresh_prompts_student_dashboard_cache.py "
                  f"--aid {DASHBOARD_AID} --tier 1 --prompt {name}")


if __name__ == "__main__":
    main()
