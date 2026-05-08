// Per-role payload schema barrel + role→schema dispatch table.
//
// Used by the role harness's payload validator: given a RoleType,
// look up the schema and parse the payload.

import type { ZodType } from 'zod'
import type { RoleType } from '../role.js'

import { TranslatorPayloadSchema, type TranslatorPayload } from './translator.js'
import { DesignerPayloadSchema, type DesignerPayload } from './designer.js'
import { ArchitectPayloadSchema, type ArchitectPayload } from './architect.js'
import { CoderPayloadSchema, type CoderPayload } from './coder.js'
import { AdversaryPayloadSchema, type AdversaryPayload } from './adversary.js'
import {
  LongTermCriticPayloadSchema,
  type LongTermCriticPayload,
} from './longTermCritic.js'
import { TestRunnerPayloadSchema, type TestRunnerPayload } from './testRunner.js'
import {
  CommunicatorPayloadSchema,
  type CommunicatorPayload,
} from './communicator.js'

export {
  TranslatorPayloadSchema,
  DesignerPayloadSchema,
  ArchitectPayloadSchema,
  CoderPayloadSchema,
  AdversaryPayloadSchema,
  LongTermCriticPayloadSchema,
  TestRunnerPayloadSchema,
  CommunicatorPayloadSchema,
}

export type {
  TranslatorPayload,
  DesignerPayload,
  ArchitectPayload,
  CoderPayload,
  AdversaryPayload,
  LongTermCriticPayload,
  TestRunnerPayload,
  CommunicatorPayload,
}

export type RolePayloadByType = {
  translator: TranslatorPayload
  designer: DesignerPayload
  architect: ArchitectPayload
  coder: CoderPayload
  adversary: AdversaryPayload
  long_term_critic: LongTermCriticPayload
  test_runner: TestRunnerPayload
  communicator: CommunicatorPayload
}

export const PAYLOAD_SCHEMAS: Record<RoleType, ZodType<unknown>> = {
  translator: TranslatorPayloadSchema,
  designer: DesignerPayloadSchema,
  architect: ArchitectPayloadSchema,
  coder: CoderPayloadSchema,
  adversary: AdversaryPayloadSchema,
  long_term_critic: LongTermCriticPayloadSchema,
  test_runner: TestRunnerPayloadSchema,
  communicator: CommunicatorPayloadSchema,
}
