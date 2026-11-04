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

  // estilo da impressão (só a área de impressão vai para o papel)
  const estilo = document.createElement('style');
  estilo.textContent = `
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

  return { lsGet, lsSet, criar, moeda, hojeLocal, api, lerArquivos, ehPdf, urlDeDados, pdfParaImagens, imprimir, obsCarimbo, lerNfDoArquivo };
})();
