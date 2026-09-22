/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 ********************************************************************************/

// Commercial Licensing Information:
// For commercial use of this software without the copyleft provisions of the AGPLv3,
// you must obtain a commercial license from CoCreate LLC.
// For details, visit <https://cocreate.app/licenses/> or contact us at sales@cocreate.app.

/*globals IntersectionObserver, CustomEvent*/
import observer from "@cocreate/observer";
import "@cocreate/element-prototype";
import {
    queryElements,
    checkValue,
    queryData,
    searchData,
    sortData,
    dotNotationToObject
} from "@cocreate/utils";

const elements = new Map();
const filters = new Map();
const clearedQueryKeys = Symbol("clearedQueryKeys");
const dispatch = new Map();
const searchVersions = new WeakMap();
const clickInitialized = new WeakSet();

const selector =
    "[filter-query], [filter-key], [filter-query-key], [filter-search], [filter-sort-key], [filter-on], [filter-limit], [filter-index]";
let initFiltersPromise = null;

async function init(element) {
    if (!element) return;

    // Normalize input to an iterable array
    let elements = element;
    if (
        !(elements instanceof HTMLCollection) &&
        !(elements instanceof NodeList) &&
        !Array.isArray(elements)
    ) {
        elements = [elements];
    }

    // Filter down to only the elements that match the selector
    const matchedElements = Array.from(elements).filter(el => el.matches(selector));

    if (matchedElements.length > 0) {
        // Await the initial filters to finish before processing matched elements
        if (initFiltersPromise) {
            await initFiltersPromise;
        }

        // Process all matched elements concurrently
        await Promise.all(matchedElements.map(el => initElement(el)));
    }

    return true;
}

async function initElement(element) {
    let filteredElements = [];
    if (!elements.has(element)) {
        await getElementFilters(element);

        initElementEvents(element);
        if (element.hasAttribute("filter-query")) {
            filteredElements = queryElements({ element, prefix: "filter" });
        } else {
            filteredElements = [element];
        }

        for (let j = 0; j < filteredElements.length; j++) {
            if (!filteredElements[j]) continue;

            if (!filters.has(filteredElements[j])) {
                initFilterOnEvent(filteredElements[j]);
                await getFilter(filteredElements[j]);
                filteredElements[j].getFilter = async () =>
                    await getFilter(filteredElements[j]);
            }
        }
    }

    return filters;
}

function initElementEvents(element) {
    if (element.hasAttribute("filter-sort-key")) initSortEvent(element);
    if (
        element.hasAttribute("filter-key") ||
        element.hasAttribute("filter-query-key") ||
        element.hasAttribute("filter-search")
    ) {
        initInputEvent(element);
    }

    // Bind click events once during initialization to avoid duplicate bindings
    if (element.getAttribute("filter-on") === "click") {
        initClickEvent(element);
    }
}

function initClickEvent(element) {
    if (!clickInitialized.has(element)) {
        element.addEventListener("click", () => updateFilter(element, true));
        clickInitialized.add(element);
    }
}

async function getElementFilters(element) {
    let filter = filters.get(element) || {};

    if (element.hasAttribute("filter-sort-key")) applySort(filter, element);
    if (element.hasAttribute("filter-key")) await applyKey(filter, element);
    if (element.hasAttribute("filter-query-key"))
        await applyQuery(filter, element);
    if (element.hasAttribute("filter-search"))
        await applySearch(filter, element);
    if (filter.query)
        filter.query = dotNotationToObject(filter.query);
    elements.set(element, filter);
    return filter;
}

async function getFilter(element) {
    let filter = await getElementFilters(element);
    filter.index = 0;

    for (let key of elements.keys()) {
        let filteredElement = queryElements({ element: key, prefix: "filter" });
        if (!filteredElement) continue;
        for (let i = 0; i < filteredElement.length; i++) {
            if (filteredElement[i] === element) {
                let filterEl = await getElementFilters(key);
                for (const key of filterEl[clearedQueryKeys] || []) removeQueryKey(filter.query, key);
                filter.query = mergeObject(
                    filter.query || {},
                    filterEl.query || {}
                );
                filter.query = dotNotationToObject(filter.query);

                if (filterEl.key)
                    filter.key = { ...(filter.key || {}), ...filterEl.key };

                if (filterEl.sort) mergeSort(filter, filterEl);

            }
        }
    }

    await setSearch(filter, element);

    if (!element.hasAttribute("filter-limit")) {
        filter.limit = 20;
    } else {
        let filterLimit = parseInt(element.getAttribute("filter-limit"));
        if (!isNaN(filterLimit)) {
            filter.limit = filterLimit;
        }
    }

    let filterIndex = parseInt(element.getAttribute("filter-index"));
    if (!isNaN(filterIndex)) {
        filter.index = filterIndex;
    }

    filter.overwrite = true;
    filters.set(element, filter);
    return filter;
}

async function updateFilter(element, loadMore) {
    let newFilter = await getElementFilters(element);

    let els = [];
    if (element.hasAttribute("filter-query")) {
        els = queryElements({ element, prefix: "filter" });
    } else if (filters.has(element)) {
        els = [element];
    }

    for (let i = 0; i < els.length; i++) {
        let filter = filters.get(els[i]);
        if (!filter) return (filter = { isFilter: false });
        if (newFilter) {
            for (const key of newFilter[clearedQueryKeys] || []) removeQueryKey(filter.query, key);
            if (newFilter.query) {
                filter.query = mergeObject(filter.query || {}, newFilter.query);
                filter.query = dotNotationToObject(filter.query);
            }

            if (newFilter.key)
                filter.key = {
                    ...(filter.key || {}),
                    ...newFilter.key
                };

            if (newFilter.sort) mergeSort(filter, newFilter);

        }

        if (!await setSearch(filter, els[i])) continue;

        if (loadMore) {
            if (!element.hasAttribute("filter-limit")) {
                filter.limit = 20;
            } else {
                let filterLimit = parseInt(
                    element.getAttribute("filter-limit")
                );
                if (!isNaN(filterLimit)) {
                    filter.limit = filterLimit;
                }
            }
            filter.loadMore = true;
            delete filter.overwrite;
        } else {
            filter.index = 0;
            delete filter.loadMore;
            let filterIndex = parseInt(element.getAttribute("filter-index"));
            if (!isNaN(filterIndex)) {
                filter.index = filterIndex;
            }
            filter.overwrite = true;
        }

        filters.set(els[i], filter);

        let delayTimer = dispatch.get(els[i]);
        clearTimeout(delayTimer);
        delayTimer = setTimeout(function () {
            dispatch.delete(els[i]);
            if (els[i].setFilter) els[i].setFilter(filter);
        }, 1000);
        dispatch.set(els[i], delayTimer);
    }
}

function removeQueryKey(query, key) {
    if (!query) return;
    if (key.endsWith(".$regex")) removeQueryKey(query, key.slice(0, -6) + "$options");
    delete query[key];
    const path = key.split(".");
    const parents = [];
    let object = query;
    for (const part of path.slice(0, -1)) {
        if (!object[part] || typeof object[part] !== "object") return;
        parents.push([object, part]);
        object = object[part];
    }
    delete object[path[path.length - 1]];
    for (const [parent, part] of parents.reverse()) {
        if (Object.keys(parent[part]).length) break;
        delete parent[part];
    }
}

function mergeObject(target, source) {
    for (const key in source) {
        if (
            source[key] &&
            typeof source[key] === "object" &&
            !Array.isArray(source[key])
        ) {
            if (!target[key] || typeof target[key] !== "object") {
                target[key] = {};
            }
            mergeObject(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

function mergeSort(filter, newFilter) {
    if (newFilter.sort) {
        if (!filter.sort) filter.sort = [...newFilter.sort];
        else {
            for (let newSort of newFilter.sort) {
                const index = filter.sort.findIndex(
                    (sort) => sort.key === newSort.key
                );
                if (index >= 0) {
                    filter.sort[index] = newSort;
                } else {
                    filter.sort.push(newSort);
                }
            }
        }
    }
}

function getEmptyQueryKeys(query, prefix = "", keys = []) {
    for (const [key, value] of Object.entries(query)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value === "") keys.push(path);
        else if (value && typeof value === "object" && !Array.isArray(value)) {
            getEmptyQueryKeys(value, path, keys);
        }
    }
    return keys;
}

async function applyQuery(filter, element) {
    delete filter[clearedQueryKeys];
    if (element.matches('input[type="radio"]') && !element.checked) return;
    const key = element.getAttribute("filter-query-key");
    if (!key || !checkValue(key)) return (filter.isFilter = false);
    let value = element.getAttribute("filter-query-value");

    if (value === null && element.getValue) value = await element.getValue();

    if (value === "" || (Array.isArray(value) && value.length === 0)) {
        removeQueryKey(filter.query, key);
        filter[clearedQueryKeys] = [key];
        delete filter.isFilter;
        return;
    }

    if (value === undefined || !checkValue(value)) return (filter.isFilter = false);

    delete filter.isFilter;
    const newFilter = { [key]: value };
    const options = element.getAttribute("filter-query-options");
    if (options) newFilter[key.replace("$regex", "$options")] = options;
    if (!filter.query) filter.query = {};

    const query = dotNotationToObject(newFilter);
    const emptyKeys = getEmptyQueryKeys(query);
    filter.query = mergeObject(filter.query, query);
    for (const emptyKey of emptyKeys) removeQueryKey(filter.query, emptyKey);
    if (emptyKeys.length) filter[clearedQueryKeys] = emptyKeys;
}

async function applyKey(filter, element) {
    let key = element.getAttribute("filter-key");

    let value = element.getAttribute("filter-value");
    if (!value && element.value !== undefined) value = await element.getValue();

    if (typeof value !== "number") {
        if (value === "true") value = 1;
        else if (value === "false") value = 0; // Fixed: parsing "false" correctly
        else value = Number(value);
    }

    if (Number.isNaN(value)) value = 1;

    if (!checkValue(key) || !checkValue(value))
        return (filter.isFilter = false);

    if (!filter.key) filter.key = {};

    filter.key[key] = value;
}

async function applySearch(filter, element) {
    let operator = element.getAttribute("filter-operator") || "or";
    let caseSensitive = element.getAttribute("filter-case-sensitive") || false;
    let value = await element.getValue();
    if (
        value === null || value === undefined || value === "" ||
        (Array.isArray(value) && value.length === 0) ||
        !checkValue(value) ||
        !checkValue(operator) ||
        !checkValue(caseSensitive)
    ) {
        delete filter.search;
        return (filter.isFilter = false);
    }

    filter.search = [{ value, operator, caseSensitive }];
}

async function setSearch(filter, element) {
    const version = (searchVersions.get(element) || 0) + 1;
    searchVersions.set(element, version);
    const search = [];

    for (const filterElement of elements.keys()) {
        if (!filterElement.hasAttribute("filter-search")) continue;

        const filteredElements = filterElement.hasAttribute("filter-query")
            ? queryElements({ element: filterElement, prefix: "filter" })
            : [filterElement];

        if (!filteredElements || !Array.from(filteredElements).includes(element))
            continue;

        const elementFilter = {};
        await applySearch(elementFilter, filterElement);
        if (elementFilter.search?.[0]) search.push(elementFilter.search[0]);
    }

    if (searchVersions.get(element) !== version) return false;
    if (search.length) filter.search = search;
    else delete filter.search;
    return true;
}

function applySort(filter, element) {
    let key = element.getAttribute("filter-sort-key");
    let direction = element.getAttribute("filter-sort-direction");

    if (!key || !direction) return;

    if (!checkValue(key) || !checkValue(direction))
        return (filter.isFilter = false);

    if (!filter.sort) filter.sort = [];

    const index = filter.sort.findIndex((sort) => sort.key === key);
    if (index >= 0) {
        filter.sort[index] = { key, direction };
    } else {
        filter.sort.push({ key, direction });
    }
}

function initSortEvent(element) {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) {
        element.addEventListener("change", function () {
            updateFilter(element);
        });
    }
}

function initInputEvent(element) {
    element.addEventListener("input", function () {
        if (
            element.hasAttribute("filter-value") ||
            element.hasAttribute("filter-query-value")
        ) {
            return;
        }
        updateFilter(element);
    });
}

function initFilterOnEvent(element) {
    element.addEventListener("fetchedData", (event) => {
        const responseData = event.detail;

        for (let el of elements.keys()) {
            let type = el.getAttribute("filter-on");
            switch (type) {
                case "scroll":
                    // Re-observe scroll triggers after data update
                    intersectionObserver.observe(el);
                    break;
                case "fetched":
                    const filter = filters.get(element);
                    const count = responseData?.count ?? responseData?.total ?? filter?.count;
                    if (count !== undefined && typeof el.setValue === "function") {
                        el.setValue(count);
                    }
                    break;
            }
        }
    });
}

const intersectionObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                updateFilter(entry.target, true);
                intersectionObserver.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 1.0
    }
);

observer.init({
    name: "CoCreateFilterInit",
    types: ["addedNodes"],
    selector,
    callback(mutation) {
        initElement(mutation.target);
    }
});

observer.init({
    name: "CoCreateFilterObserver",
    types: ["attributes"],
    attributeFilter: [
        "filter-key",
        "filter-value",
        "filter-query-key",
        "filter-query-value",
        "value",
        "filter-operator",
        "filter-value-type",
        "filter-sort-key",
        "filter-sort-direction",
        "filter-search",
        "filter-case-sensitive",
        "filter-type",
        "filter-limit",
        "filter-index"
    ],
    callback(mutation) {
        if (
            mutation.target.getAttribute(mutation.attributeName) !==
            mutation.oldValue
        ) {
            if (
                mutation.attributeName === "value" &&
                ![
                    "filter-key",
                    "filter-query-key",
                    "filter-sort-key",
                    "filter-search"
                ].some((attr) => mutation.target.hasAttribute(attr))
            ) {
                return;
            }

            if (!elements.has(mutation.target)) {
                initElement(mutation.target);
            } else {
                updateFilter(mutation.target);
            }
        }
    }
});

observer.init({
    name: "CoCreateFiltersRemovedNodes",
    types: ["removedNodes"],
    selector,
    callback: function (mutation) {
        elements.delete(mutation.target);
        filters.delete(mutation.target);
        dispatch.delete(mutation.target);
        intersectionObserver.unobserve(mutation.target);
    }
});

async function initFilters() {
    let elements = Array.from(document.querySelectorAll(selector));
    await Promise.all(elements.map(el => initElement(el)));
    return true;
}

initFiltersPromise = initFilters();

export default {
    init,
    getFilter,
    elements,
    filters,
    queryData,
    searchData,
    sortData
};