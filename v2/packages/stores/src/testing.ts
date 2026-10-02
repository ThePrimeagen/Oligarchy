import * as App from "@oligarchy/app";
import type * as Tests from "./tests.ts";
import type * as Servers from "./servers.ts";
import type * as SetupRequests from "./setup-requests.ts";
import type * as Actions from "./actions.ts";
import type * as VmStatus from "./vm-status.ts";
import type * as DebugLogs from "./debug-logs.ts";

const unexpected = (): never => {
  throw new Error("unexpected store call");
};
export const tests = (methods: Partial<Omit<Tests.Tests, "service">>) =>
  App.createService<never, App.NoOptions, Tests.Tests>(() => ({
    service: "tests",
    listTestDefinitions: unexpected,
    findTestDefinition: unexpected,
    listTestDefinitionHistory: unexpected,
    defineTestDefinition: unexpected,
    listTestBasePrompts: unexpected,
    definitionName: unexpected,
    createTestSuite: unexpected,
    getTestSuite: unexpected,
    getTestSuiteDetails: unexpected,
    listTestSuites: unexpected,
    completeSuite: unexpected,
    abortSuite: unexpected,
    ensureSetup: unexpected,
    iso: unexpected,
    serverUrl: unexpected,
    setupServer: unexpected,
    createTestRun: unexpected,
    getTestRun: unexpected,
    getTestRunDetails: unexpected,
    listTestRuns: unexpected,
    startRun: unexpected,
    completeRun: unexpected,
    errorRun: unexpected,
    timeoutRun: unexpected,
    abortRun: unexpected,
    createJob: unexpected,
    getJob: unexpected,
    getJobDetails: unexpected,
    listJobs: unexpected,
    latestJob: unexpected,
    nextPendingJob: unexpected,
    runJob: unexpected,
    completeJob: unexpected,
    finalizeJob: unexpected,
    errorJob: unexpected,
    timeoutJob: unexpected,
    abortJob: unexpected,
    ...methods,
  }))({});
export const servers = (methods: Partial<Omit<Servers.Servers, "service">>) =>
  App.createService<never, App.NoOptions, Servers.Servers>(() => ({
    service: "servers",
    addServer: unexpected,
    heartbeat: unexpected,
    removeServer: unexpected,
    listServers: unexpected,
    listMachines: unexpected,
    listLiveServers: unexpected,
    removeStaleServers: unexpected,
    findServer: unexpected,
    routeJob: unexpected,
    serverForJob: unexpected,
    ...methods,
  }))({});
export const setupRequests = (methods: Partial<Omit<SetupRequests.SetupRequests, "service">>) =>
  App.createService<never, App.NoOptions, SetupRequests.SetupRequests>(() => ({
    service: "setupRequests",
    insert: unexpected,
    setJob: unexpected,
    claim: unexpected,
    remove: unexpected,
    removeServer: unexpected,
    serverForJob: unexpected,
    list: unexpected,
    inspect: unexpected,
    ...methods,
  }))({});
export const actions = (methods: Partial<Omit<Actions.Actions, "service">>) =>
  App.createService<never, App.NoOptions, Actions.Actions>(() => ({
    service: "actions",
    startAction: unexpected,
    finishAction: unexpected,
    getImage: unexpected,
    listActions: unexpected,
    listImages: unexpected,
    listRecentActions: unexpected,
    ...methods,
  }))({});
export const vmStatus = (methods: Partial<Omit<VmStatus.VmStatus, "service">>) =>
  App.createService<never, App.NoOptions, VmStatus.VmStatus>(() => ({
    service: "vmStatus",
    record: unexpected,
    stop: unexpected,
    current: unexpected,
    history: unexpected,
    clearPastRunningVms: unexpected,
    ...methods,
  }))({});
export const debugLogs = (methods: Partial<Omit<DebugLogs.DebugLogs, "service">>) =>
  App.createService<never, App.NoOptions, DebugLogs.DebugLogs>(() => ({
    service: "debugLogs",
    saveDebugLog: unexpected,
    getDebugLog: unexpected,
    ...methods,
  }))({});
