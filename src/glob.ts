import { Minimatch, MinimatchOptions } from 'minimatch'
import { Pattern } from './pattern.js'
import { GlobCache } from './readdir.js'
import { GlobWalker } from './walker.js'

type MatchSet = Minimatch['set']
type GlobSet = Exclude<Minimatch['globSet'], undefined>
type GlobParts = Exclude<Minimatch['globParts'], undefined>

export interface GlobOptions extends MinimatchOptions {
  ignore?: string | string[]
  follow?: boolean
  mark?: boolean
  nodir?: boolean
  nounique?: boolean
  nosort?: boolean
  cwd?: string
  realpath?: boolean
  absolute?: boolean
  cache?: GlobCache
}

export class Glob {
  pattern: string[]
  ignore?: string | string[]
  follow: boolean
  dot: boolean
  mark: boolean
  nodir: boolean
  nounique: boolean
  nosort: boolean
  cwd: string
  matchSet: MatchSet
  globSet: GlobSet
  globParts: GlobParts
  realpath: boolean
  nonull: boolean
  absolute: boolean
  matchBase: boolean
  windowsPathsNoEscape: boolean
  noglobstar: boolean
  cache: GlobCache
  matches?: Set<string>

  constructor(
    pattern: string | string[],
    options: GlobOptions | Glob = {}
  ) {
    this.ignore = options.ignore
    this.follow = !!options.follow
    this.dot = !!options.dot
    this.nodir = !!options.nodir
    this.mark = !!options.mark
    this.nounique = !!options.nounique
    if (!this.nounique) {
      this.matches = new Set()
    }
    this.nosort = !!options.nosort
    this.cwd = options.cwd || ''
    if (process.platform === 'win32') {
      this.cwd = this.cwd.replace(/\\/g, '/')
    }
    this.realpath = !!options.realpath
    this.nonull = !!options.nonull
    this.absolute = !!options.absolute
    this.cache = options.cache || Object.create(null)

    this.noglobstar = !!options.noglobstar
    this.matchBase = !!options.matchBase

    if (typeof pattern === 'string') {
      pattern = [pattern]
    }

    this.windowsPathsNoEscape =
      !!options.windowsPathsNoEscape ||
      (options as GlobOptions).allowWindowsEscape === false

    if (this.windowsPathsNoEscape) {
      pattern = pattern.map(p => p.replace(/\\/g, '/'))
    }

    if (this.matchBase) {
      if (options.noglobstar) {
        throw new TypeError('base matching requires globstar')
      }
      pattern = pattern.map(p => (p.includes('/') ? p : `**/${p}`))
    }

    this.pattern = pattern

    const mmo: MinimatchOptions = {
      ...options,
      nonegate: true,
      nocomment: true,
      preserveMultipleSlashes: true,
    }

    const mms = this.pattern.map(p => new Minimatch(p, mmo))
    const [matchSet, globSet, globParts] = mms.reduce(
      (set: [MatchSet, GlobSet, GlobParts], m) => {
        set[0].push(...m.set)
        set[1].push(...m.globSet)
        set[2].push(...m.globParts)
        return set
      },
      [[], [], []]
    )
    this.matchSet = matchSet
    this.globSet = globSet
    this.globParts = globParts
  }

  async process() {
    const matches = await Promise.all(
      this.matchSet.map(async (set, i) => {
        const p = new Pattern(set, this.globParts[i], 0)
        return await this.getWalker(p).walk()
      })
    )
    return this.finish(this.doNonull(matches))
  }

  processSync() {
    const matches = this.matchSet.map((set, i) => {
      const p = new Pattern(set, this.globParts[i], 0)
      return this.getWalker(p).walkSync()
    })
    return this.finish(this.doNonull(matches))
  }

  doNonull(matches: Set<string>[]): Set<string>[] {
    const nulls: string[] = []
    matches.forEach((set, i) => {
      if (!set.size && this.nonull) {
        nulls.push(this.globSet[i])
      }
    })
    for (const n of nulls) {
      matches[0].add(n)
    }
    return matches
  }

  finish(matches: Set<string>[]): string[] {
    const raw: string[] = [...matches[0]]
    if (this.nounique) {
      for (const set of matches) {
        raw.push(...set)
      }
    }
    return this.nosort ? raw : this.sort(raw)
  }

  sort(flat: string[]) {
    return flat.sort((a, b) => a.localeCompare(b, 'en'))
  }

  getWalker(pattern: Pattern) {
    return new GlobWalker(pattern, '', this, false)
  }
}
