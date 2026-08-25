import Dexie from 'dexie'
import type { Table } from 'dexie'
import type { AbsenceLedgerItem, ClassEntity, PerClassSettings, SessionEntity, StudentEntity } from '../types'
import { DEFAULT_COOLDOWN_WEIGHT, DEFAULT_N, DEFAULT_NEVER_SEEN_WEIGHT } from '../domain/sessionDraft'

interface LegacyClassEntity extends ClassEntity {
	defaultN?: number
}

export class CheckPointDB extends Dexie {
	classes!: Table<ClassEntity, string>
	students!: Table<StudentEntity, string>
	sessions!: Table<SessionEntity, string>
	ledger!: Table<AbsenceLedgerItem, string>
	settings!: Table<PerClassSettings, string>

	constructor(name = 'CheckPointDB') {
		super(name)
		this.version(1).stores({
			classes: 'id, name',
			students: 'id, classId, displayName',
			sessions: 'id, classId, date',
			ledger: 'id, classId, studentId, date',
		})
		this.version(2).stores({
			classes: 'id, name',
			students: 'id, classId, displayName',
			sessions: 'id, classId, date',
			ledger: 'id, classId, studentId, date',
			settings: 'classId',
		})
		this.version(3).stores({
			classes: 'id, name',
			students: 'id, classId, displayName',
			sessions: 'id, classId, date',
			ledger: 'id, classId, studentId, date',
			settings: 'classId',
		}).upgrade(async (transaction) => {
			const classes = await transaction.table<LegacyClassEntity, string>('classes').toArray()
			const settingsTable = transaction.table<PerClassSettings, string>('settings')
			for (const legacy of classes) {
				const settings = await settingsTable.get(legacy.id)
				await settingsTable.put({
					classId: legacy.id,
					defaultN: settings?.defaultN ?? legacy.defaultN ?? DEFAULT_N,
					neverSeenWeight: settings?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT,
					cooldownWeight: settings?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT,
					spreadsheetId: settings?.spreadsheetId,
					lastExportedAt: settings?.lastExportedAt,
				})
				await transaction.table<ClassEntity, string>('classes').put({ id: legacy.id, name: legacy.name })
			}
		})
	}
}

export const db = new CheckPointDB()


