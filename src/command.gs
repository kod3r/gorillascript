require! cli
require! './gorilla'
require! util
require! fs
require! path
require! child_process

cli.enable 'version'

cli.set-app "gorilla", "1.0"

cli.set-usage "gorilla [OPTIONS] path/to/script.gs"

cli.parse
  ast:          ["a", "Display JavaScript AST nodes instead of compilation"]
  compile:      ["c", "Compile to JavaScript and save as .js files"]
  output:       ["o", "Set the file/directory for compiled JavaScript", "path"]
  interactive:  ["i", "Run interactively with the REPL"]
  nodes:        ["n", "Display GorillaScript parser nodes instead of compilation"]
  stdout:       ["p", "Print the compiled JavaScript to stdout"]
  stdin:        ["s", "Listen for and compile GorillaScript from stdin"]
  eval:         ["e", "Compile and run a string from command line", "string"]
  uglify:       ["u", "Uglify compiled code with UglifyJS2"]
  sourcemap:    ["m", "Build a SourceMap", "file"]
  join:         ["j", "Join all the generated JavaScript into a single file"]
  "no-prelude": [false, "Do not include the standard prelude"]

async filenames, options <- cli.main()

let opts = {}
if options.uglify
  opts.undefined-name := \undefined
  opts.uglify := true

asyncif next, options["no-prelude"]
  opts.no-prelude := true
  next()
else
  async err <- gorilla.init()
  throw? err
  next()

if options.stdout
  opts.writer := #(text) -> process.stdout.write text

let handle-code(code, callback = #->)
  asyncif err, result <- next, options.ast
    async! next, ast <- gorilla.ast code, opts
    next null, util.inspect ast.node, false, null
  else if options.nodes
    async! next, nodes <- gorilla.parse code, opts
    next null, util.inspect nodes.result, false, null
  else if options.stdout
    async! next, result <- gorilla.compile code, opts
    if opts.uglify
      process.stdout.write "\n"
    next null, result.code
  else
    async! next, result <- gorilla.eval code, opts
    next null, util.inspect result
  if err?
    callback(err)
  else
    if result != ""
      process.stdout.write "$result\n"
    callback()

if options.ast and options.compile
  console.error "Cannot specify both --ast and --compile"
else if options.ast and options.nodes
  console.error "Cannot specify both --ast and --nodes"
else if options.nodes and options.compile
  console.error "Cannot specify both --nodes and --compile"
else if options.output and not options.compile
  console.error "Must specify --compile if specifying --output"
else if options.sourcemap and not options.output
  console.error "Must specify --output if specifying --sourcemap"
else if filenames.length > 1 and options.sourcemap and not options.join
  console.error "Cannot specify --sourcemap with multiple files unless using --join"
else if options.eval?
  handle-code String(options.eval)
else if options.interactive
  require './repl'
else if options.stdin
  cli.with-stdin handle-code
else if filenames.length
  let input = {}
  asyncfor(0) err <- next, filename in filenames
    async! next, code <- fs.read-file filename
    input[filename] := code.to-string()
    next()
  throw? err
  
  let sourcemap = if options.sourcemap then require("./sourcemap")(options.output, ".")
  
  let compiled = {}
  asyncfor err <- next, filename in filenames
    let code = input[filename]
    if options.compile
      process.stdout.write "Compiling $(path.basename filename) ... "
      if options.sourcemap
        sourcemap.set-source path.basename(filename)
        opts.sourcemap := sourcemap
      let start-time = Date.now()
      async! next, compilation <- gorilla.compile code, opts
      let end-time = Date.now()
      process.stdout.write "$(((end-time - start-time) / 1000_ms).to-fixed(3)) seconds\n"
      compiled[filename] := compilation.code
      next()
    else if options.stdout
      handle-code code, next
    else
      gorilla.run code, { extends opts, filename }, next
  throw? err
  
  if options.compile
    asyncfor(0) next, filename in filenames
      let js-filename = path.basename(filename, path.extname(filename)) & ".js"
      let source-dir = path.dirname filename
      let base-dir = source-dir
      asyncif js-path <- done, options.output and filenames.length == 1
        done options.output
      else
        let dir = if options.output
          path.join options.output, base-dir
        else
          source-dir
        done path.join dir, js-filename
      let js-dir = path.dirname(js-path)
      async exists <- fs.exists js-dir
      asyncif done, not exists
        async <- child_process.exec "mkdir -p $js-dir"
        done()
      let js-code = compiled[filename]
      async err <- fs.write-file js-path, js-code, "utf8"
      if err
        cli.error err.to-string()
      next()
  
  if sourcemap?
    async err <- fs.write-file options.sourcemap, sourcemap.to-string(), "utf8"
    if err
      cli.error err.to-string()
else
  require './repl'
