const AsciiDocProcessor = require('../lib/index'),
  { TextLintCore } = require('textlint')
const textlint = new TextLintCore()
textlint.setupPlugins({
  'asciidoc': AsciiDocProcessor
})
