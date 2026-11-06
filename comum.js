/* Comum às páginas do sistema de expedições (app do celular, almoxarifado e financeiro). */

// Endereço do servidor (Apps Script da planilha), o link /exec da implantação. Mudou? Troque só aqui.
const EXPEDICOES_API = 'https://script.google.com/macros/s/AKfycbxONXzVt2YKN_v0b6ady-KVwHLqbAvjHieNv6nC8t4iuyNcT68UX2nd4Vp1aJgW5SnUWg/exec';

const Comum = (() => {
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bloqueado */ } };

  function criar(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }

  const moeda = v => v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const hojeLocal = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  /** POST de texto JSON (sem pré-verificação CORS). Erro do servidor: e.servidor; sem conexão: e.rede. */
  async function api(acao, dados, timeout) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout || 90000);
    try {
      const r = await fetch(EXPEDICOES_API, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ acao: acao }, dados || {})),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        signal: ctrl.signal
      });
      const j = await r.json();
      if (!j.ok) {
        const e = new Error(j.erro || 'Erro no servidor.');
        e.servidor = true;
        e.codigo = j.codigo || '';
        throw e;
      }
      return j.dados;
    } catch (e) {
      if (e.servidor) throw e;
      const x = new Error(navigator.onLine ? 'Não consegui falar com o servidor. Tente de novo.' : 'Sem internet.');
      x.rede = true;
      throw x;
    } finally {
      clearTimeout(t);
    }
  }

  /** Lê fotos (reduzidas para 1600 px) e PDFs (como estão, até 8 MB) e devolve data URLs. */
  function lerArquivos(lista) {
    return Promise.all(Array.from(lista).map(arq => {
      if (arq.type === 'application/pdf') {
        if (arq.size > 8 * 1024 * 1024) return Promise.reject(new Error('O PDF "' + arq.name + '" passa de 8 MB.'));
        return new Promise((res, rej) => {
          const leitor = new FileReader();
          leitor.onload = () => res(leitor.result);
          leitor.onerror = () => rej(new Error('Não consegui ler "' + arq.name + '".'));
          leitor.readAsDataURL(arq);
        });
      }
      if (!/^image\//.test(arq.type)) return Promise.reject(new Error('"' + arq.name + '" não é foto nem PDF.'));
      return new Promise((res, rej) => {
        const img = new Image();
        const url = URL.createObjectURL(arq);
        img.onload = () => {
          const esc = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * esc);
          c.height = Math.round(img.height * esc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          res(c.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Não consegui abrir "' + arq.name + '".')); };
        img.src = url;
      });
    }));
  }

  const ehPdf = dataUrl => /^data:application\/pdf/.test(dataUrl);

  function bytesDe(dataUrl) {
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** data: -> blob: (o leitor de PDF do navegador não abre data: dentro da página). */
  function urlDeDados(dataUrl) {
    const tipo = /data:([^;]+)/.exec(dataUrl)[1];
    return URL.createObjectURL(new Blob([bytesDe(dataUrl)], { type: tipo }));
  }

  // PDF -> imagens (para imprimir tudo de uma vez). pdf.js só é baixado quando precisa.
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let pdfjsPromessa = null;
  function carregarPdfJs() {
    if (!pdfjsPromessa) {
      pdfjsPromessa = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = PDFJS + 'pdf.min.js';
        s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(window.pdfjsLib); };
        s.onerror = () => { pdfjsPromessa = null; rej(new Error('Não consegui carregar o leitor de PDF (precisa de internet).')); };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromessa;
  }

  /**
   * Número da NF lido do próprio PDF (DANFE com texto): pela chave de acesso de 44 dígitos (o número
   * da nota fica nas posições 26 a 34) ou, sem chave, pelo "Nº 000.000.000" impresso. Foto ou PDF
   * escaneado (sem texto) devolve null. Lê só as 2 primeiras páginas.
   */
  async function lerNfDoArquivo(dataUrl) {
    if (!/^data:application\/pdf/.test(dataUrl || '')) return null;
    try {
      const pdfjs = await carregarPdfJs();
      const doc = await pdfjs.getDocument({ data: bytesDe(dataUrl) }).promise;
      let texto = '';
      for (let p = 1; p <= Math.min(2, doc.numPages); p++) {
        const conteudo = await (await doc.getPage(p)).getTextContent();
        texto += ' ' + conteudo.items.map(i => i.str).join(' ');
      }
      for (const b of texto.match(/(?:\d{4}[\s.]?){10}\d{4}/g) || []) {
        const chave = b.replace(/\D/g, '');
        if (chave.length === 44 && chave.slice(20, 22) === '55') return { numero: String(parseInt(chave.slice(25, 34), 10)), chave: chave };
      }
      const m = texto.match(/N[º°o]\.?\s*:?\s*(\d{1,3}(?:\.\d{3}){1,3}|\d{3,9})/);
      return m ? { numero: String(parseInt(m[1].replace(/\D/g, ''), 10)), chave: '' } : null;
    } catch (e) { return null; }
  }

  // pdf-lib: só para separar um PDF com várias notas em um PDF por nota (baixado só quando precisa)
  let pdfLibPromessa = null;
  function carregarPdfLib() {
    if (!pdfLibPromessa) {
      pdfLibPromessa = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
        s.onload = () => res(window.PDFLib);
        s.onerror = () => { pdfLibPromessa = null; rej(new Error('Não consegui carregar o separador de PDF (precisa de internet).')); };
        document.head.appendChild(s);
      });
    }
    return pdfLibPromessa;
  }

  // Chave de acesso: NF-e de produto (44 dígitos, modelo 55; número da nota nas posições 26 a 34) ou
  // NFS-e nacional de serviço (DANFSe: 50 dígitos seguidos, logo após "Chave de Acesso da NFS-e").
  function chaveDeAcesso(texto) {
    const t = String(texto || '');
    for (const b of t.match(/(?:\d{4}[\s.]?){10}\d{4}/g) || []) {
      const chave = b.replace(/\D/g, '');
      if (chave.length === 44 && chave.slice(20, 22) === '55') return chave;
    }
    if (/NFS-?e/i.test(t)) { const m = t.match(/(?<!\d)\d{50}(?!\d)/); if (m) return m[0]; }
    return '';
  }
  function numeroDaNota(texto, chave) {
    const t = String(texto || '');
    if (chave && chave.length === 44) return String(parseInt(chave.slice(25, 34), 10));
    // DANFSe: "Número da NFS-e 0026.00000000902" (o número é a parte depois do ponto)
    const s = t.match(/N[úu]mero da NFS-?e\s*:?\s*([\d.]+)/i);
    if (s) { const partes = s[1].split('.').filter(Boolean); const n = parseInt(partes[partes.length - 1], 10); if (n) return String(n); }
    const m = t.match(/N[º°o]\.?\s*:?\s*(\d{1,3}(?:\.\d{3}){1,3}|\d{3,9})/);
    return m ? String(parseInt(m[1].replace(/\D/g, ''), 10)) : '';
  }

  /**
   * Um PDF pode trazer várias notas (ex.: um arquivo "DANFE" com 5 notas). Separa pela chave de acesso:
   * quando a chave muda de uma página para a outra, começa outra nota (página sem chave fica com a anterior).
   * Devolve [{ dataUrl, numero, texto, paginas }]: um item por nota. Foto, PDF escaneado (sem texto) ou
   * PDF de uma nota só = um item com o arquivo como veio (texto vazio se não houver).
   */
  async function separarNotasPdf(dataUrl) {
    if (!/^data:application\/pdf/.test(dataUrl || '')) return [{ dataUrl: dataUrl, numero: '', texto: '', paginas: 1 }];
    let grupos = [];
    try {
      const pdfjs = await carregarPdfJs();
      const doc = await pdfjs.getDocument({ data: bytesDe(dataUrl) }).promise;
      for (let p = 1; p <= doc.numPages; p++) {
        const conteudo = await (await doc.getPage(p)).getTextContent();
        const texto = conteudo.items.map(i => i.str).join(' ');
        const chave = chaveDeAcesso(texto);
        const atual = grupos[grupos.length - 1];
        if (!atual || (chave && atual.chave && chave !== atual.chave)) grupos.push({ chave: chave, paginas: [p - 1], texto: texto });
        else { atual.paginas.push(p - 1); atual.texto += ' ' + texto; if (!atual.chave) atual.chave = chave; }
      }
    } catch (e) { return [{ dataUrl: dataUrl, numero: '', texto: '', paginas: 1 }]; }
    const item = (url, g) => ({ dataUrl: url, numero: numeroDaNota(g.texto, g.chave), texto: g.texto.slice(0, 40000), paginas: g.paginas.length });
    if (grupos.length <= 1) return [item(dataUrl, grupos[0] || { chave: '', paginas: [0], texto: '' })];
    const PDFLib = await carregarPdfLib();
    const origem = await PDFLib.PDFDocument.load(bytesDe(dataUrl), { ignoreEncryption: true });
    const saida = [];
    for (const g of grupos) {
      const novo = await PDFLib.PDFDocument.create();
      (await novo.copyPages(origem, g.paginas)).forEach(pg => novo.addPage(pg));
      saida.push(item('data:application/pdf;base64,' + await novo.saveAsBase64(), g));
    }
    return saida;
  }

  /**
   * Enquadrar a foto: mostra a imagem com um retângulo de cantos arrastáveis (dedo ou mouse) para cortar o
   * fundo. "Usar recorte" devolve só a parte de dentro; "Foto inteira" devolve a foto como veio.
   * PDF ou algo que não é foto: devolve direto, sem perguntar.
   */
  function enquadrar(dataUrl) {
    if (!/^data:image\//.test(dataUrl || '')) return Promise.resolve(dataUrl);
    return new Promise(resolve => {
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        const fundo = criar('div', 'enq-fundo');
        fundo.innerHTML = '<div class="enq-dica">Arraste os cantos para deixar só a nota</div><div class="enq-palco"></div>' +
          '<div class="enq-botoes"><button type="button" class="enq-inteira">Foto inteira</button><button type="button" class="enq-ok">✓ Usar recorte</button></div>';
        document.body.appendChild(fundo);
        const palco = fundo.querySelector('.enq-palco');
        palco.appendChild(img);
        const caixa = criar('div', 'enq-caixa');
        ['nw', 'ne', 'sw', 'se'].forEach(c => { const p = criar('span', 'enq-canto enq-' + c); p.dataset.canto = c; caixa.appendChild(p); });
        palco.appendChild(caixa);
        // retângulo em frações da imagem (0 a 1); começa com uma margem pequena
        const r = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
        const desenhar = () => {
          // a foto cabe inteira no palco (sem rolagem); o retângulo acompanha
          const escala = Math.min((palco.clientWidth - 28) / img.naturalWidth, (palco.clientHeight - 28) / img.naturalHeight);
          img.style.width = Math.round(img.naturalWidth * escala) + 'px';
          img.style.height = Math.round(img.naturalHeight * escala) + 'px';
          const W = img.clientWidth, H = img.clientHeight;
          Object.assign(caixa.style, { left: img.offsetLeft + r.x * W + 'px', top: img.offsetTop + r.y * H + 'px', width: r.w * W + 'px', height: r.h * H + 'px' });
        };
        let arraste = null;
        const ponto = e => { const b = img.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; };
        caixa.addEventListener('pointerdown', e => {
          e.preventDefault();
          caixa.setPointerCapture(e.pointerId);
          arraste = { canto: e.target.dataset.canto || 'mover', inicio: ponto(e), r0: Object.assign({}, r) };
        });
        caixa.addEventListener('pointermove', e => {
          if (!arraste) return;
          const p = ponto(e), d = { x: p.x - arraste.inicio.x, y: p.y - arraste.inicio.y }, o = arraste.r0, MIN = 0.08;
          const lim = v => Math.max(0, Math.min(1, v));
          if (arraste.canto === 'mover') {
            r.x = Math.max(0, Math.min(1 - o.w, o.x + d.x)); r.y = Math.max(0, Math.min(1 - o.h, o.y + d.y));
          } else {
            let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
            if (arraste.canto.indexOf('w') >= 0) x1 = Math.min(lim(o.x + d.x), x2 - MIN); else x2 = Math.max(lim(o.x + o.w + d.x), x1 + MIN);
            if (arraste.canto.indexOf('n') >= 0) y1 = Math.min(lim(o.y + d.y), y2 - MIN); else y2 = Math.max(lim(o.y + o.h + d.y), y1 + MIN);
            Object.assign(r, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
          }
          desenhar();
        });
        caixa.addEventListener('pointerup', () => { arraste = null; });
        const fechar = valor => { window.removeEventListener('resize', desenhar); fundo.remove(); resolve(valor); };
        fundo.querySelector('.enq-inteira').onclick = () => fechar(dataUrl);
        fundo.querySelector('.enq-ok').onclick = () => {
          const N = { w: img.naturalWidth, h: img.naturalHeight };
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(r.w * N.w));
          c.height = Math.max(1, Math.round(r.h * N.h));
          c.getContext('2d').drawImage(img, r.x * N.w, r.y * N.h, c.width, c.height, 0, 0, c.width, c.height);
          fechar(c.toDataURL('image/jpeg', 0.82));
        };
        window.addEventListener('resize', desenhar);
        requestAnimationFrame(desenhar);
      };
      img.src = dataUrl;
    });
  }

  // fotos de uma lista (dataUrls): cada uma passa pelo enquadrar, uma de cada vez
  async function enquadrarTodas(lista) {
    const saida = [];
    for (const d of lista) saida.push(await enquadrar(d));
    return saida;
  }

  async function pdfParaImagens(dataUrl) {
    const pdfjs = await carregarPdfJs();
    const doc = await pdfjs.getDocument({ data: bytesDe(dataUrl) }).promise;
    const imagens = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p);
      const vista = pagina.getViewport({ scale: 1.6 });
      const c = document.createElement('canvas');
      c.width = vista.width;
      c.height = vista.height;
      await pagina.render({ canvasContext: c.getContext('2d'), viewport: vista }).promise;
      imagens.push(c.toDataURL('image/jpeg', 0.85));
    }
    return imagens;
  }

  /**
   * Imprime "folhas": cada uma com título, tabela de dados (pares rótulo/valor) e documentos
   * (fotos ou PDFs; o PDF vira uma imagem por página). Cada documento começa numa página nova.
   * documento.carimbo = linhas de texto: sai como carimbo por cima da 1ª página (o arquivo original não muda).
   */
  async function imprimir(folhas) {
    let area = document.getElementById('areaImpressao');
    if (!area) { area = criar('div'); area.id = 'areaImpressao'; document.body.appendChild(area); }
    area.innerHTML = '';
    for (const f of folhas) {
      const folha = criar('section', 'folha');
      if (f.titulo) folha.appendChild(criar('h2', '', f.titulo));
      if (f.linhas && f.linhas.length) {
        const tabela = criar('table', 'tabela-impressao');
        f.linhas.forEach(par => {
          if (par[1] === '' || par[1] === null || par[1] === undefined) return;
          const tr = criar('tr');
          tr.appendChild(criar('th', '', par[0]));
          tr.appendChild(criar('td', '', String(par[1])));
          tabela.appendChild(tr);
        });
        folha.appendChild(tabela);
      }
      area.appendChild(folha);
      for (const doc of f.documentos || []) {
        const imagens = ehPdf(doc.src) ? await pdfParaImagens(doc.src) : [doc.src];
        imagens.forEach((src, p) => {
          // a folha inteira é do documento; embaixo, uma faixa com a identificação pequena e o carimbo à direita
          const pagina = criar('section', 'folha-doc');
          const img = document.createElement('img');
          img.src = src;
          pagina.appendChild(img);
          const rodape = criar('div', 'rodape-doc');
          rodape.appendChild(criar('div', 'legenda-doc', doc.legenda || ''));
          if (p === 0 && doc.carimbo) rodape.appendChild(carimbo(doc.carimbo));
          pagina.appendChild(rodape);
          area.appendChild(pagina);
        });
      }
    }
    await Promise.all(Array.from(area.querySelectorAll('img')).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    window.print();
  }

  // linhas: a 1ª é o título; uma linha que começa com "Obs.:" sai menor e alinhada à esquerda
  function carimbo(linhas) {
    const c = criar('div', 'carimbo');
    linhas.filter(Boolean).forEach((t, i) => c.appendChild(criar(i === 0 ? 'b' : 'div', /^Obs\.:/.test(t) ? 'obs' : '', t)));
    return c;
  }

  // Texto da observação para o carimbo (cortado para caber).
  function obsCarimbo(obs) {
    const t = String(obs || '').replace(/\s+/g, ' ').trim();
    return t ? 'Obs.: ' + (t.length > 220 ? t.slice(0, 220) + '…' : t) : '';
  }

  // estilo da impressão (só a área de impressão vai para o papel) e do enquadrar
  const estilo = document.createElement('style');
  estilo.textContent = `
    .enq-fundo { position: fixed; inset: 0; z-index: 9999; background: #111; display: flex; flex-direction: column; touch-action: none; }
    .enq-dica { color: #fff; font: 600 14px Arial, sans-serif; text-align: center; padding: calc(10px + env(safe-area-inset-top)) 10px 8px; }
    .enq-palco { position: relative; flex: 1 1 0; min-height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; padding: 14px; }
    .enq-palco img { max-width: none; max-height: none; flex: none; display: block; user-select: none; -webkit-user-drag: none; }
    .enq-caixa { position: absolute; border: 2px solid #4ade80; box-shadow: 0 0 0 9999px rgba(0,0,0,0.55); cursor: move; touch-action: none; }
    .enq-canto { position: absolute; width: 30px; height: 30px; background: #4ade80; border: 3px solid #fff; border-radius: 50%; touch-action: none; }
    .enq-nw { left: -16px; top: -16px; cursor: nwse-resize; } .enq-ne { right: -16px; top: -16px; cursor: nesw-resize; }
    .enq-sw { left: -16px; bottom: -16px; cursor: nesw-resize; } .enq-se { right: -16px; bottom: -16px; cursor: nwse-resize; }
    .enq-botoes { flex: none; display: flex; gap: 10px; padding: 10px 12px calc(12px + env(safe-area-inset-bottom)); }
    .enq-botoes button { flex: 1; padding: 14px; border-radius: 10px; font: 700 15px Arial, sans-serif; border: 1.5px solid #fff; background: transparent; color: #fff; cursor: pointer; }
    .enq-botoes .enq-ok { background: #2f7d55; border-color: #2f7d55; }
    #areaImpressao { display: none; }
    @media print {
      /* A4 com margem mínima: o documento ocupa a folha; a página de resumo ganha respiro por dentro */
      @page { size: A4; margin: 4mm 4mm 3mm 4mm; }
      html, body { margin: 0 !important; padding: 0 !important; }
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      body > *:not(#areaImpressao) { display: none !important; }
      #areaImpressao { display: block !important; color: #000; font: 12px Arial, sans-serif; }
      #areaImpressao .folha { padding: 8mm 8mm 0; }
      #areaImpressao .folha h2 { font-size: 16px; margin: 0 0 10px; }
      #areaImpressao .tabela-impressao { border-collapse: collapse; width: 100%; }
      #areaImpressao .tabela-impressao th, #areaImpressao .tabela-impressao td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; }
      #areaImpressao .tabela-impressao th { width: 32%; background: #eee; }
      #areaImpressao .folha-doc {
        page-break-before: always; break-before: page; break-inside: avoid; page-break-inside: avoid;
        height: 289mm; display: flex; flex-direction: column; overflow: hidden;
      }
      #areaImpressao .folha-doc img { flex: 1 1 auto; min-height: 0; width: 100%; height: 100%; object-fit: contain; object-position: center top; display: block; }
      #areaImpressao .rodape-doc { flex: none; display: flex; align-items: flex-end; justify-content: space-between; gap: 4mm; padding-top: 1.5mm; }
      #areaImpressao .legenda-doc { font-size: 9px; color: #444; overflow-wrap: anywhere; }
      #areaImpressao .carimbo {
        flex: none; max-width: 100mm; padding: 5px 14px; text-align: center;
        border: 3px double #1d4ed8; border-radius: 6px; color: #1d4ed8; background: #fff;
        font: 700 13px/1.4 Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      #areaImpressao .carimbo b { display: block; font-size: 15px; letter-spacing: 1px; }
      #areaImpressao .carimbo .obs { font-size: 11.5px; text-align: left; margin-top: 3px; overflow-wrap: anywhere; }
      #areaImpressao .folha + .folha { page-break-before: always; break-before: page; }
    }`;
  document.head.appendChild(estilo);

  return { lsGet, lsSet, criar, moeda, hojeLocal, api, lerArquivos, ehPdf, urlDeDados, pdfParaImagens, imprimir, obsCarimbo, lerNfDoArquivo, separarNotasPdf, enquadrar, enquadrarTodas };
})();
