import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('article navigation replaces canonical, description and structured data, including return to the index', async () => {
  const source = await readFile(new URL('../js/wiki-navigation.js', import.meta.url), 'utf8');
  const handlers = {};
  const article = { innerHTML: 'index content' };
  const location = new URL('https://akiba-tech.jp/wiki/');
  const head = {
    nodes: [],
    querySelectorAll: () => [...head.nodes],
    appendChild(node) {
      node.remove = () => { head.nodes = head.nodes.filter((value) => value !== node); };
      head.nodes.push(node);
    },
  };
  const makeNode = (value) => ({ value, cloneNode: () => makeNode(value) });
  head.appendChild(makeNode('old canonical'));
  const document = {
    title: 'Wiki', head,
    querySelector: (selector) => selector === '.wiki-document' ? article : null,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => { handlers[name] = handler; },
  };
  let destination;
  runInNewContext(source, {
    URL, document, location,
    history: { pushState: (_, __, url) => { location.href = url; } },
    fetch: async () => ({ ok: true, text: async () => '' }),
    DOMParser: class {
      parseFromString() {
        return {
          title: destination.title,
          head: { querySelectorAll: () => destination.metadata.map(makeNode) },
          querySelector: () => ({ innerHTML: destination.content }),
        };
      }
    },
    window: {
      addEventListener: (name, handler) => { handlers[name] = handler; },
      matchMedia: () => ({ matches: false }), scrollTo: () => {},
    },
  });
  destination = { title: 'Product | Overview', content: 'product content', metadata: ['product canonical', 'product description', 'product JSON-LD'] };
  let prevented = false;
  handlers.click({ target: { closest: (selector) => selector === 'a[href]' ? { href: 'https://akiba-tech.jp/wiki/product/overview.html' } : null }, preventDefault: () => { prevented = true; } });
  await new Promise(setImmediate);
  assert.equal(prevented, true);
  assert.equal(document.title, destination.title);
  assert.equal(article.innerHTML, destination.content);
  assert.deepEqual(head.nodes.map((node) => node.value), destination.metadata);
  assert.equal(location.pathname, '/wiki/product/overview.html');
  destination = { title: 'Wiki', content: 'index content', metadata: ['index canonical', 'index description'] };
  location.href = 'https://akiba-tech.jp/wiki/';
  await handlers.popstate();
  assert.equal(document.title, 'Wiki');
  assert.equal(article.innerHTML, 'index content');
  assert.deepEqual(head.nodes.map((node) => node.value), destination.metadata);
});
