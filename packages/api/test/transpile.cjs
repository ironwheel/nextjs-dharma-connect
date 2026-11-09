// Loads packages/api/lib modules into plain-node tests.
//
// Node cannot load lib's sources directly: they are TypeScript with
// extensionless imports. Each named module is transpiled to CommonJS into
// .test-build/<suite>/ (gitignored), where their relative imports resolve to
// one another.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const pkg = path.join(__dirname, '..');

/**
 * @param {string} suite - Directory name under .test-build, one per test file.
 * @param {string[]} names - lib module names, without extension.
 * @returns {string} The build directory, to require() the modules from.
 */
function transpileLib(suite, names) {
  const build = path.join(pkg, '.test-build', suite);
  fs.mkdirSync(build, { recursive: true });
  for (const name of names) {
    const source = fs.readFileSync(path.join(pkg, 'lib', `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    });
    fs.writeFileSync(path.join(build, `${name}.js`), outputText);
  }
  return build;
}

module.exports = { transpileLib };
