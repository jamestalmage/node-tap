// a thing that runs tests.
// Every "test" is also a harness.  If they do not have a harness,
// then they are attached to the defaut "global harness",
// which writes its results to stdout.


// TODO:
// - Bailout should stop running any tests.
// - "skip" in the test config obj should skip it.

module.exports = Harness
require("./inherits")(Harness, require("events").EventEmitter)

var EventEmitter = require("events").EventEmitter
  , Results = require("./results")
  , TapStream = require("./tap-stream")
  , assert = require("./assert")
  , Test = require("./test")

function Harness () {
  if (!(this instanceof Harness)) return new Harness()

  this._plan = null
  this._children = []
  this._started = false

  this._testCount = 0
  this._planSum = 0

  this.results = new Results()

  var p = this.process.bind(this)
  this.process = function () {
    this._started = true
    process.nextTick(p)
  }

  this.output = new TapStream()
  Harness.super.call(this)
}

// this function actually only gets called bound to
// the Harness object, and on process.nextTick.  Even if
// passed as an event handler, everything *else* will
// happen before it gets called.
Harness.prototype.process = function () {
  // console.error("harness process")
  // "end" can emit multiple times, so only actually move on
  // to the next test if the current one is actually over.
  // TODO: multiple in-process tests, if all are marked "async"
  if (this._current) {
    if (!this._current._ended) return
    // handle the current one before moving onto the next.
    this.childEnd(this._current)
  }
  var skip = true
  while (skip) {
    var current = this._current = this._children.shift()
    if (current) {
      skip = current.conf.skip
      if (skip) {
        // console.error("add a failure for the skipping")
        this.results.add(assert.fail(current.conf.name
                                    ,{skip:true, diag:false}))
      }
    } else skip = false
  }

  // keep processing through skipped tests, instead of running them.
  if (current && this._bailedOut) {
    return this.process()
  }

  if (current) {
    current.on("end", this.process)
    current.emit("ready")
  } else {
    // console.error("Harness process: no more left.  ending")
    this.end()
  }
}

Harness.prototype.end = function () {
  // console.error("harness end", this.constructor.name)
  if (this._bailedOut) return

  // can't call .end() more than once.
  if (this._ended) {
    // console.error("adding failure for end calling")
    this.results.add(assert.fail("end called more than once"))
  }

  // see if the plan is completed properly, if there was one.
  if (this._plan !== null) {
    var total = this.results.testsTotal
    if (total !== this._plan) {
      this.results.add(assert.equal(total, this._plan, "test count != plan"))
    }
    this._plan = total
  }

  // console.error("setting ended true", this.constructor.name)
  this._ended = true
  this.emit("end")
}

Harness.prototype.plan = function (p) {
  if (this._plan !== null) {
    // console.error("about to add failure for calling plan")
    return this.results.add(assert.fail("plan set multiple times"))
  }
  this._plan = p
  if (p === 0 || this.results.testsTotal) {
    this.end()
  }
}

Harness.prototype.childEnd = function (child) {
  this._testCount ++
  this._planSum += child._plan
  // console.error("adding set of child.results")
  this.results.addSet(child.results)
  this.emit("childEnd", child)
}

Harness.prototype.test = function test (name, conf, cb) {
  if (this._bailedOut) return

  if (typeof conf === "function") cb = conf, conf = null
  if (typeof name === "object") conf = name, name = null
  if (typeof name === "function") cb = name, name = null

  conf = conf || {}
  name = name || ""

  // console.error("making test", [name, conf, cb])

  var t = new Test(this, name, conf)
  if (cb) t.on("ready", cb.bind(t, t))
  return t
}

Harness.prototype.bailout = function (message) {
  message = message || ""
  // console.error("adding bailout message result")
  this.results.add({bailout: message})
  this._bailedOut = true
  this.emit("bailout", message)
}

Harness.prototype.add = function (child) {
  this._children.push(child)
  if (!this._started) this.process()
}