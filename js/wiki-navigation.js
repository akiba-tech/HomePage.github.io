(() => {
  const wikiRoot = '/wiki/';

  const isWikiPage = (url) => url.origin === location.origin && url.pathname.startsWith(wikiRoot);

  function setExplorerOpen(open) {
    const explorer = document.querySelector('.wiki-explorer');
    const toggle = document.querySelector('.wiki-explorer-toggle');
    if (!explorer || !toggle) return;
    explorer.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Explorerを閉じる' : 'Explorerを開く';
  }

  async function showArticle(url, pushState) {
    try {
      const response = await fetch(url.href, { headers: { 'X-Requested-With': 'wiki-navigation' } });
      if (!response.ok) throw new Error(`Unable to load ${url.pathname}`);

      const next = new DOMParser().parseFromString(await response.text(), 'text/html');
      const nextDocument = next.querySelector('.wiki-document');
      const currentDocument = document.querySelector('.wiki-document');
      if (!nextDocument || !currentDocument) throw new Error('Wiki document was not found');

      currentDocument.innerHTML = nextDocument.innerHTML;
      document.title = next.title;
      document.querySelectorAll('.wiki-explorer a[aria-current="page"]').forEach((link) => link.removeAttribute('aria-current'));
      const currentLink = [...document.querySelectorAll('.wiki-explorer a[href]')]
        .find((link) => new URL(link.href).pathname === url.pathname);
      if (currentLink) {
        currentLink.setAttribute('aria-current', 'page');
        let folder = currentLink.closest('details');
        while (folder) {
          folder.setAttribute('open', '');
          folder = folder.parentElement.closest('details');
        }
      }
      if (pushState) history.pushState({}, '', url.href);
      if (window.matchMedia('(max-width: 959px)').matches) setExplorerOpen(false);
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      // Keep direct navigation as a reliable fallback for an unavailable or malformed page.
      location.href = url.href;
    }
  }

  document.addEventListener('click', (event) => {
    const explorerToggle = event.target.closest('.wiki-explorer-toggle');
    if (explorerToggle) {
      setExplorerOpen(explorerToggle.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href);
    if (!isWikiPage(url) || url.pathname === location.pathname) return;
    event.preventDefault();
    showArticle(url, true);
  });

  window.addEventListener('popstate', () => showArticle(new URL(location.href), false));
})();
