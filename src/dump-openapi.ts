import { type AppDeps, createApp, openApiDocConfig } from '#app'

const unreachable = (): never => {
  // eslint-disable-next-line no-restricted-syntax -- OpenAPI generation only reads route schemas; handlers are never invoked, so any call is a bug
  throw new Error('unreachable: openapi generation never invokes handlers')
}

const deps: AppDeps = {
  bearerToken: '',
  notesPathPrefix: '',
  liveSync: {
    listNotesByPath: unreachable,
    readNote: unreachable,
  },
  github: {
    existsOnFohteNet: unreachable,
    findExistingPrByBranch: unreachable,
    createBranch: unreachable,
    deleteBranch: unreachable,
    commitFiles: unreachable,
    createPullRequest: unreachable,
    listBlogPrs: unreachable,
    closePullRequest: unreachable,
    resolveCiStatus: unreachable,
  },
  apply: {
    imageProcessor: { uploadAll: unreachable },
    readImage: unreachable,
    defaultBranch: '',
  },
}

const app = createApp(deps)

const document = app.getOpenAPIDocument(openApiDocConfig)

console.log(JSON.stringify(document, null, 2))
