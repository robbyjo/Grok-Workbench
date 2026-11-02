import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Chess } from 'chess.js';
export class Practice {
  private server?: Server;
  private token = randomBytes(24).toString('hex');
  private game = new Chess('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2');
  private cart = 0;
  url = '';
  state() {
    return {
      cart: this.cart,
      subtotal: this.cart * 24.5,
      shipping: this.cart ? 4.25 : 0,
      tax: this.cart ? 2.45 : 0,
      total: this.cart * 24.5 + (this.cart ? 6.7 : 0),
      fen: this.game.fen(),
      moves: this.game.history(),
      checkmate: this.game.isCheckmate(),
    };
  }
  async start() {
    const server = createServer(async (req, res) => {
      if (!this.url || req.headers.host !== new URL(this.url).host) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const url = new URL(req.url ?? '/', this.url || 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader(
          'Content-Security-Policy',
          `default-src 'self'; script-src 'nonce-${this.token}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'`,
        );
        res.end(this.html());
        return;
      }
      if (url.pathname !== '/state' && url.pathname !== '/act') {
        res.writeHead(404).end();
        return;
      }
      if (
        req.headers.authorization !== `Bearer ${this.token}` ||
        (req.headers.origin && req.headers.origin !== this.url)
      ) {
        res.writeHead(403).end();
        return;
      }
      try {
        if (url.pathname === '/act') {
          if (req.method !== 'POST') throw new Error('POST required.');
          let raw = '';
          for await (const part of req) {
            raw += part;
            if (raw.length > 4000) throw new Error('Request too large.');
          }
          const input = JSON.parse(raw);
          if (input.action === 'add') {
            if (this.cart >= 9) throw new Error('Practice quantity limit is nine.');
            this.cart++;
          } else if (input.action === 'clear') this.cart = 0;
          else if (input.action === 'move') this.game.move(input.move);
          else if (input.action === 'reset')
            this.game.load('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2');
          else throw new Error('Unsupported practice action.');
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(this.state()));
      } catch (e) {
        res
          .writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: (e as Error).message }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    this.server = server;
    this.url = `http://127.0.0.1:${(server.address() as any).port}`;
    return this.url;
  }
  close() {
    this.server?.closeAllConnections();
    this.server?.close();
  }
  private html() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Workbench application practice</title><style>
body{font:17px system-ui;background:#eef2f6;color:#182230;margin:18px}h1{font-size:24px}nav button,button,input,select{font:inherit;padding:8px;margin:4px}section{max-width:980px}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:white;padding:14px;border:1px solid #8895a3;border-radius:8px;width:260px}#board{display:grid;grid-template-columns:repeat(8,56px);width:448px;border:2px solid #182230}#board button{width:56px;height:56px;padding:0;margin:0;border:0;border-radius:0;font:40px 'Segoe UI Symbol',serif;position:relative;color:#111}#board button small{position:absolute;bottom:0;left:2px;font:10px Arial;color:#333}#board .selected{outline:4px solid #c22;outline-offset:-4px}.chess-layout{display:flex;gap:22px}.info{max-width:480px}#fen{word-break:break-all;font:15px monospace}#cart{padding:12px;border:2px solid #46796b;background:white;margin-top:12px}
</style></head><body><h1>Workbench application practice</h1><p>Local practice only: no purchases, accounts or online games.</p><nav><button id="shop-tab">Shopping practice</button><button id="chess-tab">Chess practice</button></nav>
<section id="shop"><h2>Stationery shop</h2><label>Color <select id="filter"><option value="all">All colors</option><option value="blue">Blue</option><option value="red">Red</option></select></label><div class="cards"><div class="card" data-color="blue"><h3>Blue fountain pen</h3><p>Blue · Fountain · In stock</p><strong>$24.50 USD</strong><p><button id="add">Add blue fountain pen to cart</button></p></div><div class="card" data-color="blue"><h3>Blue ballpoint pen</h3><p>Blue · Ballpoint · Out of stock</p><strong>$8.00 USD</strong><button disabled>Unavailable</button></div><div class="card" data-color="red"><h3>Red fountain pen</h3><p>Red · Fountain · Out of stock</p><strong>$22.00 USD</strong><button disabled>Unavailable</button></div></div><button id="review">Review cart</button><button id="clear">Clear practice cart</button><div id="cart" hidden></div></section>
<section id="chess" hidden><h2>Chess: Black to move, mate in one</h2><div class="chess-layout"><div id="board"></div><div class="info"><p>Untimed offline puzzle. Click the source square, then destination, or drag the piece. Every move is checked by chess.js.</p><p>Current FEN:</p><p id="fen"></p><p id="status" role="status"></p><button id="reset">Reset puzzle</button></div></div></section>
<script nonce="${this.token}">
const auth={Authorization:'Bearer ${this.token}','Content-Type':'application/json'};let state,selected=null,dragged=null;
async function act(action,extra={}){if(action==='reset'){selected=null;dragged=null;}const r=await fetch('/act',{method:'POST',headers:auth,body:JSON.stringify({action,...extra})});const v=await r.json();if(v.error){document.getElementById('status').textContent=v.error;return;}state=v;draw();}
function draw(){document.getElementById('cart').textContent='Blue fountain pen × '+state.cart+' | Subtotal $'+state.subtotal.toFixed(2)+' | Shipping $'+state.shipping.toFixed(2)+' | Tax $'+state.tax.toFixed(2)+' | Total $'+state.total.toFixed(2)+' USD. Review only: no checkout is implemented.';document.getElementById('fen').textContent=state.fen;document.getElementById('status').textContent=state.checkmate?'CHECKMATE — '+(state.fen.split(' ')[1]==='w'?'Black':'White')+' wins.':(state.fen.split(' ')[1]==='b'?'Black to move. Find mate in one.':'White to move. Reset the puzzle to try again.');const symbols={r:'♜',n:'♞',b:'♝',q:'♛',k:'♚',p:'♟',R:'♖',N:'♘',B:'♗',Q:'♕',K:'♔',P:'♙'};const board=document.getElementById('board');board.replaceChildren();const ranks=state.fen.split(' ')[0].split('/');for(let r=0;r<8;r++){let c=0;for(const item of ranks[r]){const count=Number(item)||1;for(let n=0;n<count;n++){const file='abcdefgh'[c],square=file+(8-r),piece=Number(item)?'':item,b=document.createElement('button');b.style.background=(r+c)%2?'#9bb4a1':'#f2e3c1';b.innerHTML=(symbols[piece]||'')+'<small>'+square+'</small>';b.setAttribute('aria-label',square+' '+(piece||'empty'));b.draggable=!!piece;b.onclick=()=>{if(selected){const from=selected;selected=null;void act('move',{move:{from,to:square,promotion:'q'}});}else{selected=square;b.classList.add('selected');}};b.ondragstart=e=>{dragged=square;e.dataTransfer.setData('text/plain',square);};b.ondragover=e=>e.preventDefault();b.ondrop=e=>{e.preventDefault();if(dragged)void act('move',{move:{from:dragged,to:square,promotion:'q'}});dragged=null;};board.appendChild(b);c++;}}}}
document.getElementById('filter').onchange=e=>{document.querySelectorAll('.card').forEach(c=>c.hidden=e.target.value!=='all'&&c.dataset.color!==e.target.value);};document.getElementById('add').onclick=()=>act('add');document.getElementById('clear').onclick=()=>act('clear');document.getElementById('review').onclick=()=>document.getElementById('cart').hidden=false;document.getElementById('reset').onclick=()=>act('reset');document.getElementById('shop-tab').onclick=()=>{document.getElementById('shop').hidden=false;document.getElementById('chess').hidden=true;};document.getElementById('chess-tab').onclick=()=>{document.getElementById('shop').hidden=true;document.getElementById('chess').hidden=false;};fetch('/state',{headers:auth}).then(r=>r.json()).then(v=>{state=v;draw();});
</script></body></html>`;
  }
}
