const searchInput = document.querySelector('#article-search');
const resultCount = document.querySelector('#result-count');
const rows = [...document.querySelectorAll('[data-search-row]')];

function normalize(value) {
  return value.toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

function filterArticles() {
  const terms = normalize(searchInput?.value || '').split(' ').filter(Boolean);
  let visible = 0;
  rows.forEach(row => {
    const matches = terms.every(term => row.dataset.search.includes(term));
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  if (resultCount) resultCount.textContent = `${visible} 篇`;
}

searchInput?.addEventListener('input', filterArticles);
document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput?.focus();
  }
});
