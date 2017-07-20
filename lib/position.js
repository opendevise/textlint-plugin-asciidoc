'use strict'

// line is 1-based; column is 0-based
module.exports = class Position {
  constructor (line, column = 0) {
    this.line = line
    this.column = column
  }

  offset (n) {
    return new Position(this.line, this.column + n)
  }

  toString () {
    `${this.line}:${this.column}`
  }
}
