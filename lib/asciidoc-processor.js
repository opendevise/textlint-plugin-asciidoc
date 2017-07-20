'use strict'

const AsciiDocParser = require('./asciidoc-parser'),
    LineReader = require('./line-reader')

module.exports = class AsciiDocProcessor {
  constructor (config) {
    this.config = config
  }

  static availableExtensions () {
    return ['.adoc', '.asciidoc', '.ad', '.asc']
  }

  processor (ext) {
    return {
      preProcess: (text, path) => new AsciiDocParser(new LineReader(text).readLines()).parse(),
      postProcess: (messages, path) => ({ messages: messages, filePath: (path || '<text>') })
    }
  }
}
