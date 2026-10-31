# CoCreate-filter

`@cocreate/filter` turns HTML attributes into reusable data filters. It is the filtering layer used by list, table, search, pagination, infinite-scroll, and custom data-rendering components in CoCreate applications.

The module does not fetch or render records by itself. It collects filter state from one or more elements and exposes that state to the element or data module that owns the result set.

[Docs and demo](https://CoCreateJS.com/docs/filter) | [Changelog](https://github.com/CoCreateJS/CoCreate-filter/blob/master/CHANGELOG.md) | [Issues](https://github.com/CoCreateJS/CoCreate-filter/issues)

![minified](https://img.badgesize.io/https://cdn.CoCreateJS.com/filter/latest/CoCreate-filter.min.js?style=flat-square&label=minified&color=orange)
![gzip](https://img.badgesize.io/https://cdn.CoCreateJS.com/filter/latest/CoCreate-filter.min.js?compression=gzip&style=flat-square&label=gzip&color=yellow)
![brotli](https://img.badgesize.io/https://cdn.CoCreateJS.com/filter/latest/CoCreate-filter.min.js?compression=brotli&style=flat-square&label=brotli)
![GitHub latest release](https://img.shields.io/github/v/release/CoCreate-app/CoCreate-filter?style=flat-square)
![License](https://img.shields.io/github/license/CoCreate-app/CoCreate-filter?style=flat-square)

![CoCreate-filter](https://cdn.CoCreateJS.com/docs/CoCreate-filter.gif)

## Installation

### CDN

```html
<script src="https://cdn.CoCreateJS.com/filter/latest/CoCreate-filter.min.js"></script>
```

### npm

```bash
npm install @cocreate/filter
```

```javascript
import "@cocreate/filter";
```

### yarn

```bash
yarn add @cocreate/filter
```

## How it works

The module watches elements carrying one or more `filter-*` attributes. It reads their current values, creates a filter object, and assigns that object to the result element through its `setFilter` integration.

There are two common arrangements:

1. Put filter attributes directly on the result element.
2. Put controls such as inputs, selects, and buttons inside or alongside a result element and connect them with `filter-query`.

When a control changes, the module waits one second before dispatching the updated filter. A normal update resets the result index and sets `overwrite`; a load-more update preserves existing results.

## Minimal example

```html
<input
	type="search"
	filter-query-key="name.$regex"
	placeholder="Search names"
>

<div
	id="users"
	filter-query
	database="app"
	collection="users"
	filter-limit="20"
></div>
```

The input supplies a query key and obtains its value from the input value. The result element is the filter target. The data or rendering module that owns `#users` consumes the resulting filter.

## Filter attributes

| Attribute | Purpose | Example |
| --- | --- | --- |
| `filter-query` | Marks an element as a filter target and resolves related controls. | `filter-query` |
| `filter-query-key` | Adds a query field whose value comes from the element. | `filter-query-key="user_id"` |
| `filter-query-value` | Supplies a query value directly from an attribute. | `filter-query-value="active"` |
| `filter-query-options` | Adds the options field for a regular-expression query. | `filter-query-options="i"` |
| `filter-key` | Sets a key or index value used by the consuming data module. | `filter-key="page"` |
| `filter-value` | Supplies the value for `filter-key`. | `filter-value="2"` |
| `filter-search` | Enables text search using the element's current value. | `filter-search` |
| `filter-operator` | Selects the search operator. The default is `or`. | `filter-operator="and"` |
| `filter-case-sensitive` | Controls case sensitivity for search. | `filter-case-sensitive="true"` |
| `filter-sort-key` | Selects the field to sort by. | `filter-sort-key="createdAt"` |
| `filter-sort-direction` | Selects the sort direction. | `filter-sort-direction="desc"` |
| `filter-limit` | Sets records per page. The default is `20`. | `filter-limit="50"` |
| `filter-index` | Sets the starting result index. | `filter-index="0"` |
| `filter-on` | Adds a load-more or count trigger: `click`, `scroll`, or `fetched`. | `filter-on="scroll"` |

The module currently uses the hyphenated `filter-*` attribute names shown above. They are separate from the dot assignment syntax used by `@cocreate/events`.

## Query filtering

Use `filter-query` on the result element and `filter-query-key` on a control. The control's `getValue()` result becomes the query value.

```html
<input
	filter-query-key="email.$regex"
	filter-query-options="i"
	type="search"
>
<section id="results" filter-query></section>
```

The resulting query is conceptually:

```javascript
{
	email: {
		$regex: "value",
		$options: "i"
	}
}
```

Nested keys are converted through CoCreate's dot-notation utility. Empty array values remove the corresponding query key. Missing keys, empty values, or values rejected by `checkValue` disable that contribution.

Use `filter-query-value` for a value supplied by markup:

```html
<button filter-query-key="status" filter-query-value="published">
	Published
</button>
```

Controls with explicit `filter-query-value` are not updated from their input event. Change the attribute or call the filter update integration when the value changes.

## Key and search filtering

`filter-key` contributes a value to the filter's `key` object. Numeric values are converted to numbers; invalid numeric values fall back to `1` in the current implementation.

```html
<button filter-key="page" filter-value="2">Next page</button>
<div filter-query filter-limit="20"></div>
```

Add `filter-search` to an input or another element with a CoCreate `getValue()` method:

```html
<input
	filter-search
	filter-operator="or"
	filter-case-sensitive="false"
	placeholder="Search all fields"
>
<div filter-query></div>
```

The filter contains search entries with the current value, operator, and case-sensitivity setting. The consuming data module decides which fields and search implementation to apply.

## Sorting

Sorting is represented as an array of `{ key, direction }` entries. A change event on an `INPUT`, `TEXTAREA`, or `SELECT` with sort attributes triggers a filter update.

```html
<select filter-sort-key="createdAt" filter-sort-direction="desc">
	<option value="desc">Newest</option>
	<option value="asc">Oldest</option>
</select>
<div filter-query></div>
```

Multiple sort controls can contribute different fields. If two controls use the same sort key, the later value replaces the earlier direction.

## Pagination and load more

The result element's `filter-limit` defaults to `20`. `filter-index` defaults to `0`.

```html
<div id="results" filter-query filter-limit="25"></div>
<button filter-on="click">Load more</button>
```

`filter-on="scroll"` uses `IntersectionObserver` to request more data when the trigger is fully visible. `filter-on="fetched"` writes the fetched count to the trigger through `setValue` after a `fetchedData` event.

Load-more updates set `loadMore` and preserve the existing result set. Ordinary query, search, sort, or key changes reset `index` and set `overwrite` so stale records are replaced.

## Filter object shape

The runtime maintains a filter object similar to the following:

```javascript
{
	query: { status: "published" },
	key: { page: 1 },
	search: [
		{ value: "co", operator: "or", caseSensitive: false }
	],
	sort: [
		{ key: "createdAt", direction: "desc" }
	],
	index: 0,
	limit: 20,
	overwrite: true
}
```

Only populated sections are present. The exact interpretation of `query`, `key`, and `search` belongs to the data module consuming the filter.

## JavaScript API

The package exports a default object with the following members:

```javascript
import CoCreateFilter from "@cocreate/filter";

await CoCreateFilter.init(document.querySelector("#results"));
const filter = await CoCreateFilter.getFilter(
	document.querySelector("#results")
);
```

### `init(element)`

Initializes one element, an `HTMLCollection`, a `NodeList`, or an array of elements. Elements are processed when they match the module's filter selector.

### `getFilter(element)`

Builds and returns the effective filter for an element, including contributions resolved from related controls. The module also exposes its internal `elements` and `filters` maps for integrations that need to inspect runtime state.

### Data helpers

The default export also exposes `queryData`, `searchData`, and `sortData` from `@cocreate/utils`. These helpers are available for custom consumers applying the same semantics to an in-memory array.

## Lifecycle and timing

- Matching elements initialize during startup and when added to the document.
- Supported `filter-*` attribute changes trigger a filter update.
- Input changes are debounced for `1000ms`.
- `filter-on="scroll"` uses `IntersectionObserver` with a threshold of `1`.
- Removed nodes are deleted from the module's element registry.

Because filters are assembled asynchronously, initialize dependent data/rendering modules after CoCreate has loaded, or use their lifecycle hooks rather than assuming a filter is available synchronously during HTML parsing.

## Current limitations and implementation notes

- A filter update is delayed by one second. This affects programmatic updates as well as text input.
- Empty values are treated as invalid contributions in several paths. Use removal of the filter attribute or an empty array where the consuming integration expects a cleared query.
- `filter-on="fetched"` depends on a `fetchedData` event and a `setValue` method supplied by the surrounding data component.
- The source has a duplicated `value === "true"` branch in key conversion. The intended conversion of `"false"` to `0` is not implemented; invalid numeric values fall back to `1`.
- This package coordinates filter state. It does not define database permissions, transport, record rendering, or pagination UI.

## Troubleshooting

### The filter never changes

Check that the control has a supported `filter-*` attribute, resolves a `filter-query` result element, and exposes `getValue()` when no explicit `filter-query-value` is provided. Remember that updates are delayed by one second.

### The query is missing a field

Check `filter-query-key` and the value returned by `getValue()`. Empty values and values rejected by `checkValue` are skipped. For nested fields, use dot notation such as `profile.name` or `profile.name.$regex`.

### Load more replaces the list

Make sure the update comes from an element with `filter-on="click"` or `filter-on="scroll"`. A normal input, query, sort, or key update intentionally sets `overwrite` and resets the index.

### Sorting does nothing

Sort controls only attach their automatic change listener for `INPUT`, `TEXTAREA`, and `SELECT` elements. Confirm that both `filter-sort-key` and `filter-sort-direction` are present and non-empty.

## Contributing

Please read the [contributing guide](https://github.com/CoCreateJS/CoCreate-filter/blob/master/CONTRIBUTING.md), open an [issue](https://github.com/CoCreateJS/CoCreate-filter/issues), or submit a pull request. Changes to attribute names, filter shape, debounce behavior, and lifecycle events are compatibility-sensitive and should include documentation and an example.

## License

This software is dual-licensed under the GNU Affero General Public License version 3 (AGPLv3) and a commercial license.

- **Open source use:** For open-source projects and non-commercial use, the software is available under the AGPLv3. See the [LICENSE file](https://github.com/CoCreateJS/CoCreate-filter/blob/master/LICENSE).
- **Commercial use:** For-profit use requires a commercial license from [CoCreate](https://CoCreateJS.com).
