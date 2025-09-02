import Dexie from 'dexie'
import type { Table } from 'dexie'
import type { AbsenceLedgerItem, ClassEntity, PerClassSettings, SessionEntity, StudentEntity } from './types'

export class CheckPointDB extends Dexie {
	classes!: Table<ClassEntity, string>
	students!: Table<StudentEntity, string>
	sessions!: Table<SessionEntity, string>
	ledger!: Table<AbsenceLedgerItem, string>
	settings!: Table<PerClassSettings, string>

	constructor() {
		super('CheckPointDB')
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
	}
}

export const db = new CheckPointDB()


