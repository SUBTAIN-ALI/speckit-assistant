#!/usr/bin/env python3
"""Render the companion Markdown guide. Requires reportlab (pip install reportlab)."""
from pathlib import Path
import html
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, Preformatted, Flowable, CondPageBreak,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'web-app-lifecycle-guide.md'
OUTPUT = ROOT / 'Spec-Rabbit-Complete-Web-App-Lifecycle.pdf'
INK = colors.HexColor('#172B40')
TEAL = colors.HexColor('#087F8C')
MUTED = colors.HexColor('#536578')
PALE = colors.HexColor('#EDF5F7')
LINE = colors.HexColor('#D7E2E9')
PAGE_W, PAGE_H = A4
MARGIN = 48
WIDTH = PAGE_W - 2 * MARGIN


def fonts():
    mac = Path('/System/Library/Fonts/Supplemental')
    linux = Path('/usr/share/fonts/truetype/dejavu')
    candidates = [
        (mac, ['Arial.ttf', 'Arial Bold.ttf', 'Arial Italic.ttf', 'Courier New.ttf']),
        (linux, ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans-Oblique.ttf', 'DejaVuSansMono.ttf']),
    ]
    for base, files in candidates:
        if all((base / p).is_file() for p in files):
            for name, file in zip(['Body', 'Body-Bold', 'Body-Italic', 'Mono'], files):
                pdfmetrics.registerFont(TTFont(name, str(base / file)))
            pdfmetrics.registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body-Italic', boldItalic='Body-Bold')
            return
    raise RuntimeError('Install Arial or DejaVu Sans fonts to render this guide.')


fonts()
STYLES = {
    'body': ParagraphStyle('BodyText', fontName='Body', fontSize=9.2, leading=13, textColor=INK, spaceAfter=7),
    'h1': ParagraphStyle('Chapter', fontName='Body-Bold', fontSize=21, leading=25, textColor=INK, spaceBefore=6, spaceAfter=15, keepWithNext=True),
    'h2': ParagraphStyle('Subheading', fontName='Body-Bold', fontSize=11.5, leading=15, textColor=TEAL, spaceBefore=10, spaceAfter=5, keepWithNext=True),
    'cell': ParagraphStyle('Cell', fontName='Body', fontSize=8.1, leading=11, textColor=INK, spaceAfter=0),
    'th': ParagraphStyle('TableHeading', fontName='Body-Bold', fontSize=8.1, leading=11, textColor=colors.white),
    'list': ParagraphStyle('ListItem', fontName='Body', fontSize=9.1, leading=12.7, textColor=INK, leftIndent=16, firstLineIndent=-13, spaceAfter=5),
    'code': ParagraphStyle('Code', fontName='Mono', fontSize=7.5, leading=11, textColor=INK, backColor=PALE, borderPadding=10, spaceBefore=4, spaceAfter=12),
    'caption': ParagraphStyle('Caption', fontName='Body', fontSize=8, leading=11, textColor=MUTED, spaceAfter=12),
}


def inline(text):
    # Inline code uses a body font so long paths can wrap inside narrow table cells.
    chunks = re.split(r'(`[^`]+`)', text)
    out = []
    for chunk in chunks:
        if chunk.startswith('`') and chunk.endswith('`'):
            out.append('<font color="#087F8C">' + html.escape(chunk[1:-1]) + '</font>')
        else:
            chunk = html.escape(chunk)
            chunk = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', chunk)
            out.append(chunk)
    return ''.join(out)


class Diagram(Flowable):
    """Compact vector diagrams that remain sharp when printed."""
    def __init__(self, kind):
        super().__init__()
        self.kind = kind
        self.width = WIDTH
        self.height = {'lifecycle': 198, 'states': 139, 'architecture': 196}[kind]

    def draw(self):
        c = self.canv

        def box(x, y, w, h, title, detail='', dark=False):
            c.setFillColor(INK if dark else PALE)
            c.setStrokeColor(LINE)
            c.roundRect(x, y, w, h, 6, fill=1, stroke=0)
            c.setFillColor(colors.white if dark else INK)
            c.setFont('Body-Bold', 9)
            c.drawCentredString(x+w/2, y+h/2+(4 if detail else -3), title)
            if detail:
                c.setFont('Body', 7.5)
                c.drawCentredString(x+w/2, y+h/2-10, detail)

        def arrow(x1, y1, x2, y2):
            import math
            c.setStrokeColor(TEAL)
            c.setFillColor(TEAL)
            c.setLineWidth(1.4)
            c.line(x1, y1, x2, y2)
            angle = math.atan2(y2-y1, x2-x1)
            p = c.beginPath()
            p.moveTo(x2, y2)
            p.lineTo(x2-5*math.cos(angle-.5), y2-5*math.sin(angle-.5))
            p.lineTo(x2-5*math.cos(angle+.5), y2-5*math.sin(angle+.5))
            p.close()
            c.drawPath(p, fill=1, stroke=0)

        if self.kind == 'lifecycle':
            w = (WIDTH-32)/3
            rows = [
                [('1. Open & configure', 'Workspace, tools, constitution'), ('2. Capture & review', 'Meeting, PRD, or manual input'), ('3. Define features', 'Grouping and specification')],
                [('6. Approve & operate', 'Human review; deploy on demand'), ('5. Review & validate', 'Personas, fixes, preview, tests'), ('4. Plan & implement', 'Clarify, plan, tasks, code')],
            ]
            for r, entries in enumerate(rows):
                for col, (title, detail) in enumerate(entries):
                    box(col*(w+16), 111-r*78, w, 58, title, detail, r == 0 and col == 0)
            arrow(w+2, 140, w+14, 140)
            arrow(2*w+18, 140, 2*w+30, 140)
            arrow(WIDTH-w/2, 109, WIDTH-w/2, 93)
            arrow(2*w+30, 62, 2*w+18, 62)
            arrow(w+14, 62, w+2, 62)
            c.setFillColor(MUTED)
            c.setFont('Body-Italic', 8)
            c.drawCentredString(WIDTH/2, 13, 'Changes and operational findings return to requirements and specification.')
        elif self.kind == 'states':
            labels = ['idle', 'running', 'awaiting_review', 'approved']
            w = (WIDTH-45)/4
            for i, label in enumerate(labels):
                box(i*(w+15), 74, w, 40, label, dark=i == 3)
                if i < 3:
                    arrow(i*(w+15)+w+2, 94, (i+1)*(w+15)-2, 94)
            c.setFont('Body', 8)
            c.setFillColor(MUTED)
            c.drawString(0, 50, 'Failure/reset → idle     |     Quick Build → intermediate phases skipped')
            c.drawString(0, 31, 'Upstream changes → stale flag     |     Blocked review gate may remain running')
            c.drawString(0, 12, 'State progression records decisions; review the underlying evidence.')
        else:
            layers = [
                ('Browser UI', 'Workflow • Requirements • Agents • Tools • Review'),
                ('Next.js routes + middleware', 'HTTP actions and streamed events'),
                ('Domain services + ports', 'Workflow rules, requirements, preview, tests, chat'),
                ('Infrastructure adapters', 'Workspace files • CLI processes • APIs • Zoom MCP'),
            ]
            for i, (title, detail) in enumerate(layers):
                y = 150-i*47
                box(20, y, WIDTH-40, 38, title, detail, i == 2)
                if i < 3:
                    arrow(WIDTH/2, y-1, WIDTH/2, y-8)


class Cover(Flowable):
    def __init__(self):
        super().__init__()
        self.width, self.height = WIDTH, 660

    def draw(self):
        c = self.canv
        c.setFillColor(TEAL)
        c.roundRect(0, 584, 116, 25, 5, stroke=0, fill=1)
        c.setFont('Body-Bold', 9)
        c.setFillColor(colors.white)
        c.drawString(12, 593, 'PRODUCT GUIDE')
        c.setFillColor(INK)
        c.setFont('Body-Bold', 47)
        c.drawString(0, 515, 'Spec Rabbit')
        c.setFont('Body-Bold', 26)
        c.drawString(0, 459, 'Complete Web App')
        c.drawString(0, 425, 'Lifecycle & Scenarios')
        c.setStrokeColor(TEAL)
        c.setLineWidth(4)
        c.line(0, 393, 85, 393)
        for y, line in zip([355, 333, 311], [
            'How the app turns intent into specifications,',
            'implementation, review, validation, and operations.',
            'A functional guide grounded in the current source.',
        ]):
            c.setFillColor(MUTED)
            c.setFont('Body', 12)
            c.drawString(0, y, line)
        c.setFillColor(PALE)
        c.roundRect(0, 133, WIDTH, 112, 8, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont('Body-Bold', 11)
        c.drawString(18, 217, '18 chapters  /  8 worked scenarios')
        c.setFont('Body', 9.5)
        for y, line in zip([193, 175, 157], [
            'Setup • Requirements • Workflow • Review • Preview • Browser tests',
            'Agents • MCP • Architecture • Storage • Operations • Troubleshooting',
            'API and CLI reference • Clickable contents • Editable source included',
        ]):
            c.drawString(18, y, line)
        c.setFont('Body-Bold', 10)
        c.setFillColor(TEAL)
        c.drawString(0, 83, '13 NOVEMBER 2026')
        c.setFont('Body', 9)
        c.setFillColor(MUTED)
        c.drawString(0, 62, 'Package 0.4.0 • Source snapshot with local changes • Base 90335d9')


class GuideDoc(BaseDocTemplate):
    def __init__(self):
        super().__init__(str(OUTPUT), pagesize=A4, rightMargin=MARGIN, leftMargin=MARGIN,
                         topMargin=58, bottomMargin=49,
                         title='Spec Rabbit — Complete Web App Lifecycle & Scenarios',
                         author='Spec Rabbit Project', subject='Functional lifecycle and scenario guide')
        self.addPageTemplates(PageTemplate('Guide', [Frame(MARGIN, 49, WIDTH, PAGE_H-107, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=self.decorate))

    def beforeDocument(self):
        self.chapter = 'Product guide'

    def decorate(self, c, doc):
        if doc.page == 1:
            return
        c.saveState()
        c.setStrokeColor(LINE)
        c.setLineWidth(.6)
        c.line(MARGIN, PAGE_H-37, PAGE_W-MARGIN, PAGE_H-37)
        c.line(MARGIN, 35, PAGE_W-MARGIN, 35)
        c.setFont('Body-Bold', 8)
        c.setFillColor(TEAL)
        c.drawString(MARGIN, PAGE_H-28, 'SPEC RABBIT')
        c.setFont('Body', 7.5)
        c.setFillColor(MUTED)
        c.drawRightString(PAGE_W-MARGIN, PAGE_H-28, 'WEB APP LIFECYCLE & SCENARIOS')
        c.drawString(MARGIN, 22, 'Source-based guide  •  13 Nov 2026')
        c.drawRightString(PAGE_W-MARGIN, 22, str(doc.page))
        c.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == 'Chapter' and re.match(r'^\d{2} \| ', flowable.getPlainText()):
            text = flowable.getPlainText()
            key = 'chapter-' + text.split(' | ')[0]
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, 0, False)
            self.notify('TOCEntry', (0, text, self.page, key))


def table(rows):
    count = len(rows[0])
    if count == 2:
        widths = [WIDTH * .285, WIDTH * .715]
    elif count == 3:
        widths = [WIDTH * .235, WIDTH * .34, WIDTH * .425]
    else:
        widths = [WIDTH/count]*count
    data = [[Paragraph(inline(cell), STYLES['th' if i == 0 else 'cell']) for cell in row] for i, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), INK),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LINEBELOW', (0, 0), (-1, 0), .5, INK),
        ('LINEBELOW', (0, 1), (-1, -1), .25, LINE),
    ]))
    return [t, Spacer(1, 12)]


def build():
    story = [Cover(), PageBreak(), Paragraph('Contents', STYLES['h1'])]
    story.append(Paragraph('Use this page or the PDF bookmarks to jump to a chapter. Page numbers refer to the PDF pages, including the cover.', STYLES['body']))
    toc = TableOfContents()
    toc.levelStyles = [ParagraphStyle('TOC', fontName='Body', fontSize=9.5, leading=15, textColor=INK, spaceBefore=5, spaceAfter=2)]
    toc.dotsMinLevel = 0
    story.extend([toc, PageBreak()])
    lines = SOURCE.read_text().splitlines()
    i = 0
    first = True
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith('# '):
            if not first:
                story.extend([CondPageBreak(290), Spacer(1, 19)])
            first = False
            story.append(Paragraph(inline(line[2:]), STYLES['h1']))
            i += 1
        elif line.startswith('## '):
            story.append(Paragraph(inline(line[3:]), STYLES['h2']))
            i += 1
        elif line.startswith('::: '):
            story.append(Diagram(line[4:].strip()))
            i += 1
        elif line.startswith('```'):
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code.append(lines[i])
                i += 1
            # Wrap commands at whitespace for print without clipping.
            import textwrap
            wrapped = []
            for source_line in code:
                wrapped.extend(textwrap.wrap(source_line, width=91, subsequent_indent='  ', break_long_words=False, break_on_hyphens=False) or [''])
            story.append(Preformatted('\n'.join(wrapped), STYLES['code']))
            i += 1
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r'[:\- ]+', c) for c in cells):
                    rows.append(cells)
                i += 1
            story.extend(table(rows))
        elif re.match(r'^(\d+\. |\- )', line):
            match = re.match(r'^(\d+\.|\-) (.*)', line)
            bullet = '•' if match[1] == '-' else match[1]
            story.append(Paragraph(inline(bullet+' '+match[2]), STYLES['list']))
            i += 1
        else:
            para = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||```|:::|\d+\. |\- )', lines[i]):
                para.append(lines[i])
                i += 1
            story.append(Paragraph(inline(' '.join(para)), STYLES['body']))
    GuideDoc().multiBuild(story)
    print(OUTPUT)


if __name__ == '__main__':
    build()
