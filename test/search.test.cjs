const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

async function setup() {
    const utils = await import('@cocreate/utils');
    const context = vm.createContext({
        console,
        document: { querySelectorAll: () => [] },
        HTMLCollection: class {}, NodeList: class {},
        IntersectionObserver: class { observe() {} unobserve() {} },
        setTimeout: (callback) => setTimeout(callback, 0), clearTimeout
    });
    const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    const module = new vm.SourceTextModule(source, { context });
    await module.link((specifier) => {
        const exports = specifier === '@cocreate/utils'
            ? { ...utils, queryElements: ({ element }) => element.targets || [] }
            : specifier === '@cocreate/observer' ? { default: { init() {} } } : {};
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    return module.namespace.default;
}

function element(value, attributes = {}, targets = []) {
    const listeners = new Map();
    return {
        value, attributes, targets, tagName: 'INPUT',
        getAttribute(name) { return this.attributes[name] ?? null; },
        hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
        async getValue() { return this.value; },
        matches() { return true; },
        addEventListener(name, callback) { listeners.set(name, callback); },
        input() { listeners.get('input')(); }
    };
}
const values = (filter) => Array.from(filter.search || [], (term) => term.value);

async function fixture() {
    const api = await setup();
    const target = element();
    const first = element('first', { 'filter-search': '', 'filter-query': '#target' }, [target]);
    const second = element('second', { 'filter-search': '', 'filter-query': '#target' }, [target]);
    await api.init([first, second]);
    return { api, target, first, second };
}

function update(field, target) {
    return new Promise((resolve) => {
        target.setFilter = resolve;
        field.input();
    });
}

test('input rebuilds all mapped search values without accumulating old terms', { timeout: 3000 }, async () => {
    const { target, first, second } = await fixture();
    second.value = 'changed without an event';
    for (const value of ['one', 'two', 'three']) {
        first.value = value;
        const filter = await update(first, target);
        assert.deepEqual(values(filter), [value, 'changed without an event']);
        assert.equal(filter.index, 0);
        assert.equal(filter.overwrite, true);
    }
});

test('cleared fields are removed and clearing every field removes search', { timeout: 3000 }, async () => {
    const { target, first, second } = await fixture();
    first.value = '';
    assert.deepEqual(values(await update(first, target)), ['second']);
    second.value = '';
    assert.equal((await update(second, target)).search, undefined);
});

test('rebuild reads current options and excludes fields mapped to another target', async () => {
    const { api, target, first, second } = await fixture();
    first.attributes['filter-case-sensitive'] = 'true';
    first.attributes['filter-operator'] = 'and';
    second.targets = [element()];
    const filter = await api.getFilter(target);
    assert.deepEqual(values(filter), ['first']);
    assert.equal(filter.search[0].caseSensitive, 'true');
    assert.equal(filter.search[0].operator, 'and');
});

test('searching a target itself never reuses a different field from its aggregate filter', async () => {
    const api = await setup();
    const target = element('own', { 'filter-search': '' });
    const external = element('external', { 'filter-search': '', 'filter-query': '#target' }, [target]);
    await api.init(external);
    for (let i = 0; i < 3; i++) {
        assert.deepEqual(values(await api.getFilter(target)), ['external', 'own']);
    }
});

test('an older asynchronous rebuild cannot replace the newer search', async () => {
    const { api, target, first } = await fixture();
    let release;
    let started;
    const reading = new Promise(resolve => { started = resolve; });
    first.getValue = () => {
        started();
        return new Promise(resolve => { release = resolve; });
    };
    const old = api.getFilter(target);
    await reading;
    first.getValue = async () => 'new';
    await api.getFilter(target);
    release('old');
    await old;
    assert.deepEqual(values(api.filters.get(target)), ['new', 'second']);
});
