const JellyfinClient = require('./jellyfinClient');

/**
 * Paged iterator over Jellyfin movies.
 * @param {JellyfinClient} client - instance of JellyfinClient
 * @param {object} options
 * @param {number} options.pageSize - number of items per page (Limit)
 */
async function* fetchMoviesIterator(clientOrOpts = {}, opts = {}) {
  let client = clientOrOpts;
  if (!client || typeof client.getItems !== 'function') {
    // assume options object passed first
    client = new JellyfinClient(clientOrOpts);
  }

  const pageSize = opts.pageSize || 100;
  const includeFields = opts.fields || 'ProviderIds,ProductionYear';

  let startIndex = 0;
  while (true) {
    const params = {
      IncludeItemTypes: 'Movie',
      Recursive: 'true',
      Fields: includeFields,
      StartIndex: startIndex,
      Limit: pageSize,
    };

    const res = await client.getItems(params);
    const items = res?.Items || [];

    for (const it of items) {
      yield {
        id: it.Id || it.Id || it.id,
        name: it.Name || it.Name || it.Title || null,
        productionYear: it.ProductionYear || it.ProductionYear || null,
        providerIds: it.ProviderIds || it.ProviderIds || null,
        raw: it,
      };
    }

    const total = Number(res?.TotalRecordCount || 0);
    startIndex += items.length;

    if (items.length === 0) break;
    if (total && startIndex >= total) break;
  }
}

/**
 * Convenience function: fetch all movies into an array.
 * Use with care for very large libraries.
 */
async function fetchAllMovies(clientOrOpts = {}, opts = {}) {
  const arr = [];
  for await (const movie of fetchMoviesIterator(clientOrOpts, opts)) {
    arr.push(movie);
  }
  return arr;
}

module.exports = {
  fetchMoviesIterator,
  fetchAllMovies,
};
