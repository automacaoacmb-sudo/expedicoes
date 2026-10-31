/* Comum às páginas do sistema de expedições (app do celular, almoxarifado e financeiro). */

// Endereço do servidor (Apps Script da planilha), o link /exec da implantação. Mudou? Troque só aqui.
const EXPEDICOES_API = 'https://script.google.com/macros/s/AKfycbwBmgzl3VKmWN45LPiu8wMumbXVXU7prY-F-OKulAr7N5PtLigjcgH8ZCJat839aWsocA/exec';

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
        imagens.forEach(src => {
          const pagina = criar('section', 'folha-doc');
          if (doc.legenda) pagina.appendChild(criar('div', 'legenda-doc', doc.legenda));
          const img = document.createElement('img');
          img.src = src;
          pagina.appendChild(img);
          area.appendChild(pagina);
        });
      }
    }
    await Promise.all(Array.from(area.querySelectorAll('img')).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    window.print();
  }

  // estilo da impressão (só a área de impressão vai para o papel)
  const estilo = document.createElement('style');
  estilo.textContent = `
    #areaImpressao { display: none; }
    @media print {
      @page { margin: 12mm; }
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      body > *:not(#areaImpressao) { display: none !important; }
      #areaImpressao { display: block !important; color: #000; font: 12px Arial, sans-serif; }
      #areaImpressao .folha h2 { font-size: 16px; margin: 0 0 10px; }
      #areaImpressao .tabela-impressao { border-collapse: collapse; width: 100%; }
      #areaImpressao .tabela-impressao th, #areaImpressao .tabela-impressao td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; }
      #areaImpressao .tabela-impressao th { width: 32%; background: #eee; }
      #areaImpressao .folha-doc { page-break-before: always; break-before: page; }
      #areaImpressao .legenda-doc { margin-bottom: 6px; font-size: 11px; }
      #areaImpressao .folha-doc img { max-width: 100%; max-height: 250mm; }
      #areaImpressao .folha + .folha { page-break-before: always; break-before: page; }
    }`;
  document.head.appendChild(estilo);

  return { lsGet, lsSet, criar, moeda, hojeLocal, api, lerArquivos, ehPdf, urlDeDados, pdfParaImagens, imprimir };
})();
