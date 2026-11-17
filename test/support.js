// What the suites share: a consumer staged and compiled the way a project's
// own build does it, the API definitions in test/def with the models apidef
// builds from them, and a generation that writes the library to disk.
//
// The test kit generates into memory and has no way to hand generation the
// resolved definition. This target's point is that definition, and its
// output has to compile and run, so the suite generates for itself: through
// SdkGen's own entry, with apidef's build result as the build context, into
// the staged project.

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { execFileSync } = require('node:child_process')

const { Aontu } = require('aontu')
const { ApiDef } = require('@voxgig/apidef')
const { SdkGen, cmp, each, names, Project, Folder, Main } = require('@voxgig/sdkgen')
const { PLACEHOLDERS } = require('@voxgig/sdkgen/testkit')


const PKG = Path.resolve(__dirname, '..')
const DEF_DIR = Path.join(__dirname, 'def')
const TARGET = 'ts-seed'

const TSC = Path.join(PKG, 'node_modules', 'typescript', 'bin', 'tsc')


// Compiles the consumer's components with this package's own tsc and
// tsconfig, which is what a consumer's build does.
function compileConsumer(consumer) {
  const config = Path.join(consumer.root, 'tsconfig.json')
  const outdir = Path.join(consumer.sdk, 'dist', 'cmp')
  Fs.copyFileSync(Path.join(PKG, 'tsconfig.json'), config)
  execFileSync(process.execPath, [TSC, '--project', config, '--outDir', outdir],
    { cwd: PKG, stdio: 'inherit' })
}


function defs() {
  return Fs.readdirSync(DEF_DIR).filter((file) => /\.ya?ml$/.test(file)).sort()
    .map((file) => ({ api: file.replace(/-\d.*$/, ''), file, path: Path.join(DEF_DIR, file) }))
}


const quiet = {
  trace() { }, debug() { }, info() { }, warn() { }, error() { }, fatal() { },
  child() { return quiet },
}


// Runs apidef over one definition inside a staged consumer. The result
// carries the resolved definition apidef publishes for the generators.
async function buildApi(consumer, def) {
  const model = Path.join(consumer.sdk, 'model')
  const prefix = def.api + '-'

  Fs.mkdirSync(Path.join(consumer.sdk, 'def'), { recursive: true })
  Fs.copyFileSync(def.path, Path.join(consumer.sdk, 'def', def.file))
  Fs.mkdirSync(Path.join(model, 'guide'), { recursive: true })
  Fs.writeFileSync(Path.join(model, 'guide', prefix + 'guide.aontu'),
    '@"@voxgig/apidef/model/guide.aontu"\n@"./' + prefix + 'base-guide.aontu"\n')

  const build = await ApiDef.makeBuild({ folder: model, outprefix: prefix, pino: quiet })
  const result = await consumer.inSdk(() =>
    build({ name: def.api, def: def.file }, { spec: { base: model }, log: quiet }, {}))

  if (!result.ok) {
    throw new Error('apidef could not build ' + def.file + ': ' +
      (result.err?.message || 'failed after ' + (result.steps || []).join(', ')))
  }
  return result
}


// The compiled model for one built API: its own model files, unified with the
// base schemas and the consumer's installed targets.
function apiModel(consumer, api, extra = '') {
  const prefix = api + '-'
  const src = [
    '@"@voxgig/apidef/model/apidef.aontu"',
    '@"@voxgig/sdkgen/model/sdkgen.aontu"',
    '@"target/target-index.aontu"',
    '@"feature/feature-index.aontu"',
    '@"api/' + prefix + 'api-info.aontu"',
    '@"entity/' + prefix + 'entity-index.aontu"',
    '@"flow/' + prefix + 'flow-index.aontu"',
    "name: '" + api + "'",
    // A project's own config supplies this; an API model does not.
    "main: kit: config: headers: { 'content-type': 'application/json' }",
    extra,
  ].join('\n')

  const path = Path.join(consumer.sdk, 'model', prefix + 'test.aontu')
  Fs.writeFileSync(path, src)

  const errs = []
  const model = new Aontu().generate(src, { path, errs })
  if (0 < errs.length) {
    throw new Error(api + ': the model did not compile: ' + errs.map((e) => e.msg).join(' | '))
  }
  return model
}


// A project's Root, cut down to what a target with every phase off needs.
function root() {
  return cmp(function Root(props) {
    const { model, ctx$ } = props

    model.const = model.const || { name: model.name }
    names(model.const, model.name)
    names(model, model.name)

    ctx$.model = model
    ctx$.stdrep = ctx$.stdrep || {}
    names(ctx$.stdrep, model.Name, 'Project' + 'Name')

    Project({}, () => {
      each(model.main.kit.target || {})
        .filter((t) => t && false !== t.active)
        .map((t) => {
          names(t, t.name)
          Folder({ name: t.name }, () => Main({ target: t }))
        })
    })
  })
}


function walk(dir, base = dir) {
  const out = {}
  for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
    const full = Path.join(dir, entry.name)
    if ('.jostraca' === entry.name || 'node_modules' === entry.name) continue
    if (entry.isDirectory()) Object.assign(out, walk(full, base))
    else out[Path.relative(base, full).split(Path.sep).join('/')] = Fs.readFileSync(full, 'utf8')
  }
  return out
}


function leaksOf(files) {
  const leaks = []
  for (const [path, text] of Object.entries(files)) {
    for (const token of PLACEHOLDERS) if (text.includes(token)) leaks.push(path + ': ' + token)
    const ref = text.match(/\$\$[A-Za-z_][A-Za-z0-9_.]*\$\$/)
    if (null != ref) leaks.push(path + ': ' + ref[0])
  }
  return leaks
}


// Runs a generation in the staged project and moves each named target's
// output, side by side, into a directory of its own. `built` is apidef's
// build result; without it the generation has no definition, as under the
// test kit. A failed generation throws its own error.
async function generateTargets(consumer, model, built, targets) {
  const sdkgen = SdkGen({ fs: Fs, folder: consumer.root, root: '', pino: consumer.log })
  for (const target of targets) Fs.rmSync(Path.join(consumer.root, target), { recursive: true, force: true })

  const res = await consumer.inSdk(() => sdkgen.generate({
    model, root: root(), ...(null == built ? {} : { buildctx: built }),
  }))
  if (true !== res.ok) {
    throw res.err instanceof Error ? res.err : new Error('generation failed: ' + JSON.stringify(res))
  }

  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), targets.join('-') + '-'))
  const out = {}
  for (const target of targets) {
    const made = Path.join(consumer.root, target)
    Fs.cpSync(made, Path.join(dir, target), { recursive: true })
    Fs.rmSync(made, { recursive: true, force: true })
    const files = walk(Path.join(dir, target))
    out[target] = { dir: Path.join(dir, target), files, leaks: leaksOf(files) }
  }
  return { dir, ...out }
}


// Generates the target into the staged project and moves the result to a
// directory of its own.
async function generate(consumer, model, built) {
  const made = await generateTargets(consumer, model, built, [TARGET])
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'ts-seed-'))
  Fs.cpSync(made[TARGET].dir, dir, { recursive: true })
  Fs.rmSync(made.dir, { recursive: true, force: true })
  return { dir, files: made[TARGET].files, leaks: made[TARGET].leaks }
}


// Compiles a generated library with its own tsconfig. Returns tsc's output,
// which is empty when the library compiles.
function compileLibrary(dir) {
  try {
    execFileSync(process.execPath, [TSC, '-p', Path.join(dir, 'tsconfig.json')],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return ''
  }
  catch (err) {
    return String(err.stdout || '') + String(err.stderr || '') || String(err.message)
  }
}


module.exports = {
  PKG, DEF_DIR, TARGET, defs, buildApi, apiModel, compileConsumer, generate, generateTargets, compileLibrary,
}
