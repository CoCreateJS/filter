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
        matches(selector) {
            return selector === 'input[type="radio"]' ? this.attributes.type === 'radio' : true;
        },
        addEventListener(name, callback) { listeners.set(name, callback); },
        input() { listeners.get('input')(); }
    };
}

function update(field, target) {
    return new Promise(resolve => {
        target.setFilter = resolve;
        field.input();
    });
}

test('array input replaces $in values and empty selection removes only that condition', async () => {
    const api = await setup();
    const target = element();
    const field = element(['storage', 'cloud'], {
        'filter-query-key': 'type.$in', 'filter-query': '#target'
    }, [target]);
    const enabled = element(true, {
        'filter-query-key': 'enabled', 'filter-query': '#target'
    }, [target]);
    await api.init([field, enabled]);
    field.value = ['cloud'];
    let filter = await update(field, target);
    assert.deepEqual(Array.from(filter.query.type.$in), ['cloud']);
    field.value = [];
    filter = await update(field, target);
    assert.equal(filter.query.type, undefined);
    assert.equal(filter.query.enabled, true);
    assert.equal((await api.getFilter(target)).query.type, undefined);
});

test('rebuilding the target reads current checkbox group values', async () => {
    const api = await setup();
    const target = element();
    const fields = ['storage', 'cloud'].map(() => element(['storage'], {
        'filter-query-key': 'type.$in', 'filter-query': '#target'
    }, [target]));
    await api.init(fields);
    for (const field of fields) field.value = ['cloud'];
    assert.deepEqual(Array.from((await api.getFilter(target)).query.type.$in), ['cloud']);
    for (const field of fields) field.value = [];
    assert.equal((await api.getFilter(target)).query.type, undefined);
});

test('unchecked radio contributes no query and a checked reset clears $in', async () => {
    const api = await setup();
    const target = element();
    const radio = element([], {
        type: 'radio', 'filter-query-key': 'type.$in', 'filter-query': '#target'
    }, [target]);
    radio.checked = false;
    const categories = element(['storage'], {
        'filter-query-key': 'type.$in', 'filter-query': '#target'
    }, [target]);
    await api.init([categories, radio]);
    assert.deepEqual(Array.from((await api.getFilter(target)).query.type.$in), ['storage']);
    categories.value = [];
    radio.checked = true;
    assert.equal((await update(radio, target)).query.type, undefined);
});

for (const key of ['name', 'name.$eq', 'name.$regex']) {
    test(`empty string clears ${key} and removes an empty parent`, async () => {
        const api = await setup();
        const target = element();
        const field = element('before', {
            'filter-query-key': key, 'filter-query': '#target',
            ...(key.endsWith('$regex') ? { 'filter-query-options': 'i' } : {})
        }, [target]);
        await api.init(field);
        field.value = '';
        assert.equal((await update(field, target)).query.name, undefined);
        assert.equal((await api.getFilter(target)).query.name, undefined);
    });
}

test('nested empty operators clear stale conditions while preserving other operators', async () => {
    const api = await setup();
    const target = element();
    const field = element({ $gte: 0, $lt: 100 }, {
        'filter-query-key': 'price', 'filter-query': '#target'
    }, [target]);
    await api.init(field);
    field.value = { $gte: 0, $lt: '' };
    let query = (await update(field, target)).query;
    assert.equal(query.price.$gte, 0);
    assert.equal(Object.hasOwn(query.price, '$lt'), false);
    field.value = { $gte: '' };
    assert.equal((await update(field, target)).query.price, undefined);
});

test('false, zero, null, and whitespace remain valid query values', async () => {
    const api = await setup();
    const target = element();
    const field = element(true, {
        'filter-query-key': 'field.$exists', 'filter-query': '#target'
    }, [target]);
    await api.init(field);
    for (const [operator, value] of [['$exists', false], ['$gte', 0], ['$eq', null], ['$eq', ' ']]) {
        field.attributes['filter-query-key'] = `field.${operator}`;
        field.value = value;
        assert.equal((await update(field, target)).query.field[operator], value);
    }
});

test('an explicitly empty filter-query-value clears instead of reading the element value', async () => {
    const api = await setup();
    const target = element();
    const field = element('stale element value', {
        'filter-query-key': 'name', 'filter-query': '#target', 'filter-query-value': 'before'
    }, [target]);
    await api.init(field);
    field.attributes['filter-query-value'] = '';
    await api.init(element('', { 'filter-query': '#target' }, [target]));
    assert.equal((await api.getFilter(target)).query.name, undefined);
});

test('nested operator cleanup also works below a dotted field path', async () => {
    const api = await setup();
    const target = element();
    const field = element({ $eq: 'before' }, {
        'filter-query-key': 'provider.name', 'filter-query': '#target'
    }, [target]);
    await api.init(field);
    field.value = { $eq: '' };
    assert.equal((await update(field, target)).query.provider, undefined);
});


test('an empty collection condition retains readable metadata projection and limit', async () => {
    const api = await setup();
    const target = element('', { 'filter-query-key': 'content-type.$ne', 'filter-limit': '30' });
    const projection = element(1, { 'filter-key': 'name', 'filter-value': '1', 'filter-query': '#target' }, [target]);
    await api.init([target, projection]);
    let filter = await api.getFilter(target);
    assert.notEqual(filter.isFilter, false);
    assert.equal(filter.limit, 30);
    assert.equal(filter.key.name, 1);
    target.value = 'text/directory';
    filter = await api.getFilter(target);
    assert.equal(filter.query['content-type'].$ne, 'text/directory');
    target.value = '';
    filter = await api.getFilter(target);
    assert.notEqual(filter.isFilter, false);
    assert.equal(filter.query['content-type'], undefined);
    assert.equal(filter.limit, 30);
});

test('a valid condition recovers from a previously invalid filter', async () => {
    const api = await setup();
    const target = element(undefined, { 'filter-query-key': 'name', 'filter-limit': '30' });
    await api.init(target);
    assert.equal((await api.getFilter(target)).isFilter, false);
    target.value = 'logo.svg';
    const filter = await api.getFilter(target);
    assert.notEqual(filter.isFilter, false);
    assert.equal(filter.query.name, 'logo.svg');
});
