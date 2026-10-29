// iPhone home-screen widget for the lp site, for the free Scriptable app.
// Shows one record from the crate as an LP with its cover as the label; a different one every hour.
// Tap it and the site opens with that record on the turntable.
// Setup: Scriptable → + → paste this → name it "lp" → home screen → add a Scriptable widget → Script: lp.

const SITE = 'https://leenamgyeol-spec.github.io/lp/';
const INK = new Color('#f1ebe0');
const DIM = new Color('#f1ebe0', 0.55);
const ACCENT = new Color('#ffad4d');
const VINYL = new Color('#0b0a09');

async function loadAlbums() {
  try {
    const data = await new Request(`${SITE}albums.json`).loadJSON();
    return Array.isArray(data.albums) ? data.albums : [];
  } catch {
    return [];
  }
}

async function loadCover(album) {
  if (!album.cover) return null;
  try { return await new Request(SITE + album.cover).loadImage(); } catch { return null; }
}

// The record seen from above: black vinyl, faint grooves, the cover as a round label.
function drawRecord(cover, px) {
  const ctx = new DrawContext();
  ctx.size = new Size(px, px);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const c = px / 2, R = px / 2 - 2, r = R * 0.38;

  ctx.setFillColor(VINYL);
  ctx.fillEllipse(new Rect(c - R, c - R, R * 2, R * 2));

  // the cover, squared over the label, then the vinyl ring drawn over its corners makes it round
  if (cover) ctx.drawImageInRect(cover, new Rect(c - r, c - r, r * 2, r * 2));
  else { ctx.setFillColor(ACCENT); ctx.fillEllipse(new Rect(c - r, c - r, r * 2, r * 2)); }
  const w = R - r;
  ctx.setStrokeColor(VINYL);
  ctx.setLineWidth(w);
  ctx.strokeEllipse(new Rect(c - r - w / 2, c - r - w / 2, (r + w / 2) * 2, (r + w / 2) * 2));

  // grooves
  ctx.setLineWidth(0.6);
  for (let g = r + 4; g < R - 2; g += 3.2) {
    ctx.setStrokeColor(new Color('#ffffff', 0.04 + ((g * 7) % 5) / 120));
    ctx.strokeEllipse(new Rect(c - g, c - g, g * 2, g * 2));
  }
  // a band of light across the grooves
  ctx.setStrokeColor(new Color('#ffe6c4', 0.1));
  ctx.setLineWidth(w * 0.5);
  const s = r + w * 0.5;
  ctx.strokeEllipse(new Rect(c - s, c - s, s * 2, s * 2));
  ctx.setFillColor(VINYL);
  ctx.fillEllipse(new Rect(c - R * 0.03, c - R * 0.03, R * 0.06, R * 0.06)); // spindle hole
  ctx.setStrokeColor(new Color('#ffffff', 0.12));
  ctx.setLineWidth(1);
  ctx.strokeEllipse(new Rect(c - R, c - R, R * 2, R * 2)); // the rim
  return ctx.getImage();
}

function background(widget) {
  const g = new LinearGradient();
  g.colors = [new Color('#1c1916'), new Color('#070606')];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  widget.backgroundGradient = g;
}

function text(stack, value, font, color, lines = 1) {
  const t = stack.addText(value);
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.7;
  return t;
}

async function build() {
  const widget = new ListWidget();
  background(widget);
  const albums = await loadAlbums();
  const size = config.widgetFamily || 'medium';

  if (!albums.length) {
    text(widget, 'lp.', Font.heavySystemFont(28), INK);
    text(widget, '레코드를 불러오지 못했어요', Font.systemFont(12), DIM, 2);
    widget.url = SITE;
    return widget;
  }

  // a different record each hour
  const album = albums[Math.floor(Date.now() / 3600000) % albums.length];
  const record = drawRecord(await loadCover(album), size === 'small' ? 220 : 300);
  widget.url = `${SITE}#${encodeURIComponent(album.id)}`;
  widget.refreshAfterDate = new Date(Math.ceil(Date.now() / 3600000) * 3600000);

  if (size === 'small') {
    widget.setPadding(12, 12, 12, 12);
    const img = widget.addImage(record);
    img.imageSize = new Size(92, 92);
    img.centerAlignImage();
    widget.addSpacer(6);
    text(widget, album.title, Font.heavySystemFont(14), INK);
    text(widget, album.artist || '', Font.mediumSystemFont(11), DIM);
    return widget;
  }

  widget.setPadding(14, 14, 14, 16);
  const row = widget.addStack();
  row.centerAlignContent();
  const img = row.addImage(record);
  img.imageSize = new Size(126, 126);
  row.addSpacer(14);
  const col = row.addStack();
  col.layoutVertically();
  text(col, 'ON THE PLATTER', Font.semiboldSystemFont(9), ACCENT);
  col.addSpacer(4);
  text(col, album.title, Font.heavySystemFont(20), INK, 2);
  col.addSpacer(2);
  text(col, album.artist || '', Font.mediumSystemFont(12), DIM);
  col.addSpacer(8);
  text(col, `${album.tracks.length}곡 · 눌러서 듣기`, Font.mediumSystemFont(10), DIM);
  row.addSpacer();
  return widget;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
