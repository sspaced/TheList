/**
 * Visual feedback for a save — shown ON THE PRODUCT PAGE, not in the list.
 *
 * That is where the user is when they press the shortcut. The icon badge
 * (✓ / ? / ×) already existed but it is tiny, tucked in a corner, and gone in
 * 2.5 s: you can save ten items without ever noticing it. We keep it anyway — it
 * remains the only feedback possible on pages where Chrome forbids injection
 * (chrome://, the Web Store, the PDF viewer).
 *
 * The injected function is necessarily SELF-CONTAINED: `executeScript`
 * serialises it to run inside the page, so it can capture nothing from this
 * module. Everything it needs arrives through `args`, translated copy included.
 */

/**
 * Rendered inside the page. A shadow DOM is mandatory: without it the merchant's
 * stylesheet applies to the toast — Amazon forces its font, Apple its margins —
 * and the box loses all composure. The shadow root isolates, both ways.
 */
function paint({ title, kind }) {
  const ID = '__wishlist_toast__';
  // The preference is read IN THE PAGE, not in the service worker: it is the
  // user's system setting, and the worker has no matchMedia.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(ID)?.remove();

  const host = document.createElement('div');
  host.id = ID;
  // Maximal z-index: product pages stack sticky banners, basket panels and
  // cookie notices. Below them the toast would be invisible.
  host.style.cssText =
    'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none';

  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:9px 12px',
    'border:1px solid #000',
    'background:#fff',
    'color:#000',
    'font:13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
    'box-shadow:0 2px 0 rgba(0,0,0,.18)',
    reduceMotion ? '' : 'opacity:0;transform:translateY(-6px);transition:opacity .12s ease-out,transform .12s ease-out',
  ]
    .filter(Boolean)
    .join(';');

  const text = document.createElement('span');
  text.textContent = title;
  // The verdict never breaks onto two lines.
  text.style.cssText = 'font-weight:700;white-space:nowrap;flex:none';
  box.append(text);

  /**
   * THE MARK: A SQUARE WHOSE OUTLINE IS DRAWN ALL THE WAY ROUND.
   *
   * The shape stays square — that is the vocabulary of the whole page. What is
   * animated is the STROKE: it starts at the middle of the top edge and travels
   * clockwise, like a hand sweeping. The ✓ is black and present from the very
   * first frame: you do not wait for the end to know it was saved, the outline
   * merely confirms it.
   *
   * An SVG rather than a CSS border: you cannot animate a border being drawn,
   * whereas a `stroke-dashoffset` returning to zero draws exactly that. The path
   * starts at the top middle rather than at a corner — starting from an angle
   * reads as an offset, not as a beginning. The length is MEASURED
   * (`getTotalLength`) rather than computed: a one-pixel rounding error would
   * leave the outline unfinished.
   */
  const NS = 'http://www.w3.org/2000/svg';

  const mark = document.createElement('span');
  mark.style.cssText = 'position:relative;flex:none;width:20px;height:20px;display:block';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.style.cssText = 'position:absolute;inset:0';

  const frame = document.createElementNS(NS, 'path');
  // Offset by half a pixel: a 1 px stroke centred on the edge would hang half
  // outside and render blurred.
  frame.setAttribute('d', 'M10 .5 H19.5 V19.5 H.5 V.5 Z');
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', '#000');
  frame.setAttribute('stroke-width', '1');
  svg.append(frame);
  mark.append(svg);

  const glyph = document.createElement('span');
  glyph.textContent = kind === 'ok' ? '✓' : kind === 'warn' ? '?' : '×';
  // No forced weight: the sign takes the weight of the box's text. In bold it
  // outweighed the message it accompanies.
  glyph.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#000';
  mark.append(glyph);

  box.append(mark);

  /**
   * THE TOAST IS A DOOR: clicking it opens TheList.
   *
   * It is the natural continuation of a save — you have just put something in the
   * list, and the only thing you might want next is to look at it. Until now that
   * meant the keyboard shortcut or the context menu, from a page that had just
   * told you the save worked.
   *
   * `pointer-events` stays off on the host so the toast never swallows a click
   * meant for the page beneath it; it is turned back on for the box alone, which
   * is exactly the clickable surface. The box keeps `role=status` rather than
   * becoming a button: the announcement is the point, and a toast that inserts
   * itself into the tab order for 2.4 s costs more than it gives — the list
   * already has a shortcut and a menu entry for anyone on a keyboard.
   */
  box.style.cursor = 'pointer';
  box.style.pointerEvents = 'auto';
  box.onclick = () => {
    // The injected function can import nothing, so it cannot open a tab itself:
    // only the service worker can. Both failure modes are swallowed — the throw
    // of an extension reloaded since the injection, and the rejection that
    // follows a listener which opens the tab without answering ("the message port
    // closed before a response was received"). Neither is worth a page-console
    // error for a click that did what it was asked.
    try {
      chrome.runtime.sendMessage({ theList: 'open' })?.catch(() => {});
    } catch {}
    host.remove();
  };

  root.append(box);
  document.documentElement.append(host);

  // Only after insertion: `getTotalLength` requires the path to be laid out.
  //
  // THREE STEPS, AND THE ORDER IS EVERYTHING.
  //
  //   1. the path length, in `px`: `stroke-dasharray` accepts a bare number,
  //      `stroke-dashoffset` demands a unit — without it the value was ignored;
  //   2. we PIN that starting point by reading the computed style, with the
  //      transition not yet armed;
  //   3. only then is the transition armed, and the next frame aims at zero.
  //
  // 520 ms, on a curve that is gentle at the start: the previous one
  // (.22,.61,.36,1) covered 35 % of the loop in 40 ms, which read as a jump
  // followed by a drag. The stroke must advance evenly, so the eye can follow it.
  //
  // Arming the transition in the same mutation that sets the starting value
  // animated the start itself — the browser transitioned from 0 towards 76 while
  // the next frame asked for 0 again. The offset never left zero: the square was
  // full from the outset, and no change of duration made any difference.
  const len = frame.getTotalLength();
  frame.style.strokeDasharray = `${len}px`;
  frame.style.strokeDashoffset = reduceMotion ? '0px' : `${len}px`;
  if (!reduceMotion) {
    void getComputedStyle(frame).strokeDashoffset;
    frame.style.transition = 'stroke-dashoffset .52s cubic-bezier(.45,.05,.3,1)';
  }

  if (!reduceMotion) {
    requestAnimationFrame(() => {
      box.style.opacity = '1';
      box.style.transform = 'translateY(0)';
      frame.style.strokeDashoffset = '0px';
    });
  }

  // 2.4 s is long enough to READ a verdict, not to aim at it: the box would slide
  // away from under the cursor halfway through the click. Hovering therefore holds
  // it, and leaving restarts the countdown from the top — the toast only leaves
  // once you have stopped looking at it.
  let timer;
  const dismiss = () => {
    if (reduceMotion) return host.remove();
    box.style.opacity = '0';
    box.style.transform = 'translateY(-6px)';
    setTimeout(() => host.remove(), 160);
  };
  const arm = () => {
    timer = setTimeout(dismiss, 2400);
  };
  box.onmouseenter = () => clearTimeout(timer);
  box.onmouseleave = arm;
  arm();
}

/**
 * Shows the toast in the tab. Never fails loudly: on a Chrome-internal page the
 * injection is refused, and that is no reason to break a save that succeeded.
 */
export async function toast(tabId, payload) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: paint,
      args: [payload],
    });
  } catch {}
}
