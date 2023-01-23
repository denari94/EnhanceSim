import { Popup } from './popup';
import { IndividualSimUI } from '../individual_sim_ui';
import { SimUI } from '../sim_ui';
import { TypedEvent } from '../typed_event';
import {
	Class,
	EquipmentSpec,
	ItemSlot,
	Glyphs,
	ItemSpec,
	Profession,
	Race,
	Spec,
} from '../proto/common';
import { IndividualSimSettings } from '../proto/ui';
import { Database } from '../proto_utils/database';
import { classNames, nameToClass, nameToRace, nameToProfession } from '../proto_utils/names';
import { classGlyphsConfig, talentSpellIdsToTalentString } from '../talents/factory';
import { GlyphConfig } from '../talents/glyphs_picker';
import { buf2hex } from '../utils';

export abstract class Importer extends Popup {
	protected readonly textElem: HTMLTextAreaElement;
	protected readonly descriptionElem: HTMLElement;
	protected readonly importButton: HTMLButtonElement;
	private readonly includeFile: boolean;

	constructor(parent: HTMLElement, simUI: SimUI, title: string, includeFile: boolean) {
		super(parent);
		this.includeFile = includeFile;
		const uploadInputId = 'upload-input-' + title.toLowerCase().replaceAll(' ', '-');

		this.rootElem.classList.add('importer');
		let htmlVal = `
			<span class="importer-title">${title}</span>
			<div class="import-description">
			</div>
			<div class="import-content">
				<textarea class="importer-textarea form-control"></textarea>
			</div>
			<div class="actions-row">
		`;
		if (this.includeFile) {
			htmlVal += `<label for="${uploadInputId}" class="importer-button btn btn-${simUI.cssScheme} upload-button">UPLOAD FROM FILE</label>
				<input type="file" id="${uploadInputId}" class="importer-upload-input" hidden>
			`
		}
		htmlVal += `<button class="importer-button btn btn-${simUI.cssScheme} import-button">IMPORT</button>
			</div>
		`;

		this.rootElem.innerHTML = htmlVal

		this.addCloseButton();

		this.textElem = this.rootElem.getElementsByClassName('importer-textarea')[0] as HTMLTextAreaElement;
		this.descriptionElem = this.rootElem.getElementsByClassName('import-description')[0] as HTMLElement;

		if (this.includeFile) {
			const uploadInput = this.rootElem.getElementsByClassName('importer-upload-input')[0] as HTMLButtonElement;
			uploadInput.addEventListener('change', async event => {
				const data: string = await (event as any).target.files[0].text();
				this.textElem.textContent = data;
			});
		}

		this.importButton = this.rootElem.getElementsByClassName('import-button')[0] as HTMLButtonElement;
		this.importButton.addEventListener('click', event => {
			try {
				this.onImport(this.textElem.value || '');
			} catch (error) {
				alert('Import error: ' + error);
			}
		});
	}

	abstract onImport(data: string): void

	protected async finishIndividualImport<SpecType extends Spec>(simUI: IndividualSimUI<SpecType>, charClass: Class, race: Race, equipmentSpec: EquipmentSpec, talentsStr: string, glyphs: Glyphs | null, professions: Array<Profession>): Promise<void> {
		const playerClass = simUI.player.getClass();
		if (charClass != playerClass) {
			throw new Error(`Wrong Class! Expected ${classNames[playerClass]} but found ${classNames[charClass]}!`);
		}

		await Database.loadLeftoversIfNecessary(equipmentSpec);

		const gear = simUI.sim.db.lookupEquipmentSpec(equipmentSpec);

		const expectedEnchantIds = equipmentSpec.items.map(item => item.enchant);
		const foundEnchantIds = gear.asSpec().items.map(item => item.enchant);
		const missingEnchants = expectedEnchantIds.filter(expectedId => expectedId != 0 && !foundEnchantIds.includes(expectedId));

		const expectedItemIds = equipmentSpec.items.map(item => item.id);
		const foundItemIds = gear.asSpec().items.map(item => item.id);
		const missingItems = expectedItemIds.filter(expectedId => !foundItemIds.includes(expectedId));

		// Now update settings using the parsed values.
		const eventID = TypedEvent.nextEventID();
		TypedEvent.freezeAllAndDo(() => {
			simUI.player.setRace(eventID, race);
			simUI.player.setGear(eventID, gear);
			if (talentsStr && talentsStr != '--') {
				simUI.player.setTalentsString(eventID, talentsStr);
			}
			if (glyphs) {
				simUI.player.setGlyphs(eventID, glyphs)
			}
			if (professions.length > 0) {
				simUI.player.setProfessions(eventID, professions)
			}
		});

		this.close();

		if (missingItems.length == 0 && missingEnchants.length == 0) {
			alert('Import successful!');
		} else {
			alert('Import successful, but the following IDs were not found in the sim database:' +
				(missingItems.length == 0 ? '' : '\n\nItems: ' + missingItems.join(', ')) +
				(missingEnchants.length == 0 ? '' : '\n\nEnchants: ' + missingEnchants.join(', ')));
		}
	}
}

export class IndividualJsonImporter<SpecType extends Spec> extends Importer {
	private readonly simUI: IndividualSimUI<SpecType>;
	constructor(parent: HTMLElement, simUI: IndividualSimUI<SpecType>) {
		super(parent, simUI, 'JSON Import', true);
		this.simUI = simUI;

		this.descriptionElem.innerHTML = `
			<p>
				Import settings from a JSON text file, which can be created using the JSON Export feature of this site.
			</p>
			<p>
				To import, paste the JSON text below and click, 'Import'.
			</p>
		`;
	}

	async onImport(data: string) {
		const proto = IndividualSimSettings.fromJsonString(data, { ignoreUnknownFields: true });
		if (proto.player?.equipment) {
			await Database.loadLeftoversIfNecessary(proto.player.equipment);
		}
		if (this.simUI.isWithinRaidSim) {
			if (proto.player) {
				this.simUI.player.fromProto(TypedEvent.nextEventID(), proto.player);
			}
		} else {
			this.simUI.fromProto(TypedEvent.nextEventID(), proto);
		}
		this.close();
	}
}

export class Individual80UImporter<SpecType extends Spec> extends Importer {
	private readonly simUI: IndividualSimUI<SpecType>;
	constructor(parent: HTMLElement, simUI: IndividualSimUI<SpecType>) {
		super(parent, simUI, '80 Upgrades Import', true);
		this.simUI = simUI;

		this.descriptionElem.innerHTML = `
			<p>
				Import settings from <a href="https://eightyupgrades.com" target="_blank">Eighty Upgrades</a>.
			</p>
			<p>
				This feature imports gear, race, and (optionally) talents. It does NOT import buffs, debuffs, consumes, rotation, or custom stats.
			</p>
			<p>
				To import, paste the output from the site's export option below and click, 'Import'.
			</p>
		`;
	}

	onImport(data: string) {
		const importJson = JSON.parse(data);

		// Parse all the settings.
		const charClass = nameToClass((importJson?.character?.gameClass as string) || '');
		if (charClass == Class.ClassUnknown) {
			throw new Error('Could not parse Class!');
		}

		const race = nameToRace((importJson?.character?.race as string) || '');
		if (race == Race.RaceUnknown) {
			throw new Error('Could not parse Race!');
		}

		let talentsStr = '';
		if (importJson?.talents?.length > 0) {
			const talentIds = (importJson.talents as Array<any>).map(talentJson => talentJson.spellId);
			talentsStr = talentSpellIdsToTalentString(charClass, talentIds);
		}

		let equipmentSpec = EquipmentSpec.create();
		(importJson.items as Array<any>).forEach(itemJson => {
			let itemSpec = ItemSpec.create();
			itemSpec.id = itemJson.id;
			if (itemJson.enchant?.id) {
				itemSpec.enchant = itemJson.enchant.id;
			}
			if (itemJson.gems) {
				itemSpec.gems = (itemJson.gems as Array<any>).filter(gemJson => gemJson?.id).map(gemJson => gemJson.id);
			}
			equipmentSpec.items.push(itemSpec);
		});

		const gear = this.simUI.sim.db.lookupEquipmentSpec(equipmentSpec);

		this.finishIndividualImport(this.simUI, charClass, race, equipmentSpec, talentsStr, null, []);
	}
}

export class IndividualWowheadGearPlannerImporter<SpecType extends Spec> extends Importer {
	private readonly simUI: IndividualSimUI<SpecType>;
	constructor(parent: HTMLElement, simUI: IndividualSimUI<SpecType>) {
		super(parent, simUI, 'WoWHead Import', true);
		this.simUI = simUI;

		this.descriptionElem.innerHTML = `
			<p>
				Import settings from <a href="https://www.wowhead.com/wotlk/gear-planner" target="_blank">WoWHead Gear Planner</a>.
			</p>
			<p>
				This feature imports gear, race, and (optionally) talents. It does NOT import buffs, debuffs, consumes, rotation, or custom stats.
			</p>
			<p>
				To import, paste the gear planner link below and click, 'Import'.
			</p>
		`;
	}

	onImport(url: string) {
		const match = url.match(/www\.wowhead\.com\/wotlk\/gear-planner\/([a-z\-]+)\/([a-z\-]+)\/([a-zA-Z0-9_\-]+)/);
		if (!match) {
			throw new Error(`Invalid WCL URL ${url}, must look like "https://www.wowhead.com/wotlk/gear-planner/CLASS/RACE/XXXX"`);
		}

		// Parse all the settings.
		const charClass = nameToClass(match[1].replaceAll('-', ' '));
		if (charClass == Class.ClassUnknown) {
			throw new Error('Could not parse Class: ' + match[1]);
		}

		const race = nameToRace(match[2].replaceAll('-', ' '));
		if (race == Race.RaceUnknown) {
			throw new Error('Could not parse Race: ' + match[2]);
		}

		const base64Data = match[3].replaceAll('_', '/').replaceAll('-', '+');
		//console.log('Base64: ' + base64Data);
		const data = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
		//console.log('Hex: ' + buf2hex(data));

		// Binary schema
		// Byte 00: ??
		// Byte 01: ?? Seems related to aesthetics (e.g. body type)
		// Byte 02: 8-bit Player Level
		// Byte 03: 8-bit length of talents bytes
		// Next N Bytes: Talents in hex string format

		// Talent hex string looks like '230005232100330150323102505321f03f023203001f'
		// Just like regular wowhead talents string except 'f' instead of '-'.
		const numTalentBytes = data[3];
		const talentBytes = data.subarray(4, 4 + numTalentBytes);
		const talentsHexStr = buf2hex(talentBytes);
		const talentsStr = talentsHexStr.split('f').slice(0, 3).join('-');
		//console.log('Talents: ' + talentsStr);

		let cur = 4 + numTalentBytes;
		const numGlyphsBytes = data[cur];
		cur++;
		const glyphsBytes = data.subarray(cur, cur + numGlyphsBytes);
		const gearBytes = data.subarray(cur + numGlyphsBytes);
		//console.log(`Next ${numGlyphsBytes} bytes: ${buf2hex(glyphsBytes)}`);
		//console.log(`Remaining ${gearBytes.length} bytes: ${buf2hex(gearBytes)}`);

		// First byte in glyphs section seems to always be 0x30
		cur++;
		// TODO: Figure out glyphs format

		// Binary schema for each item:
		// 8-bit slotNumber, high bit = is enchanted
		// 8-bit upper 3 bits for gem count
		// 16-bit item id
		// if enchant bit is set:
		//   8-bit ??, possibly enchant position for multiple enchants?
		//   16-bit enchant id
		// for each gem:
		//   8-bit upper 3 bits for gem position
		//   16-bit gem item id
		const equipmentSpec = EquipmentSpec.create();
		cur = 0;
		while (cur < gearBytes.length) {
			const itemSpec = ItemSpec.create();
			const slotId = gearBytes[cur] & 0b01111111;
			const isEnchanted = Boolean(gearBytes[cur] & 0b10000000);
			cur++;

			const numGems = (gearBytes[cur] & 0b11100000) >> 5;
			cur++;

			itemSpec.id = (gearBytes[cur] << 8) + gearBytes[cur + 1];
			cur += 2;
			//console.log(`Slot ID: ${slotId}, isEnchanted: ${isEnchanted}, numGems: ${numGems}, itemID: ${itemSpec.id}`);

			if (isEnchanted) {
				// Ignore first byte, seems to always be 0?
				cur++;

				// Note: this is the enchant SPELL id, not the effect ID.
				const enchantSpellId = (gearBytes[cur] << 8) + gearBytes[cur + 1];
				itemSpec.enchant = this.simUI.sim.db.enchantSpellIdToEffectId(enchantSpellId);
				cur += 2;
				//console.log(`Enchant ID: ${itemSpec.enchant}`);
			}

			for (let gemIdx = 0; gemIdx < numGems; gemIdx++) {
				const gemPosition = (gearBytes[cur] & 0b11100000) >> 5;
				cur++;

				const gemId = (gearBytes[cur] << 8) + gearBytes[cur + 1];
				cur += 2;
				//console.log(`Gem position: ${gemPosition}, gemID: ${gemId}`);

				if (!itemSpec.gems) {
					itemSpec.gems = [];
				}
				while (itemSpec.gems.length < gemPosition) {
					itemSpec.gems.push(0);
				}
				itemSpec.gems[gemPosition] = gemId;
			}

			// Ignore tabard / shirt slots
			const itemSlotEntry = Object.entries(IndividualWowheadGearPlannerImporter.slotIDs).find(e => e[1] == slotId);
			if (itemSlotEntry != null) {
				equipmentSpec.items.push(itemSpec);
			}
		}
		const gear = this.simUI.sim.db.lookupEquipmentSpec(equipmentSpec);

		this.finishIndividualImport(this.simUI, charClass, race, equipmentSpec, talentsStr, null, []);
	}

	static slotIDs: Record<ItemSlot, number> = {
		[ItemSlot.ItemSlotHead]: 1,
		[ItemSlot.ItemSlotNeck]: 2,
		[ItemSlot.ItemSlotShoulder]: 3,
		[ItemSlot.ItemSlotBack]: 15,
		[ItemSlot.ItemSlotChest]: 5,
		[ItemSlot.ItemSlotWrist]: 9,
		[ItemSlot.ItemSlotHands]: 10,
		[ItemSlot.ItemSlotWaist]: 6,
		[ItemSlot.ItemSlotLegs]: 7,
		[ItemSlot.ItemSlotFeet]: 8,
		[ItemSlot.ItemSlotFinger1]: 11,
		[ItemSlot.ItemSlotFinger2]: 12,
		[ItemSlot.ItemSlotTrinket1]: 13,
		[ItemSlot.ItemSlotTrinket2]: 14,
		[ItemSlot.ItemSlotMainHand]: 16,
		[ItemSlot.ItemSlotOffHand]: 17,
		[ItemSlot.ItemSlotRanged]: 18,
	};
}

export class IndividualAddonImporter<SpecType extends Spec> extends Importer {
	private readonly simUI: IndividualSimUI<SpecType>;
	constructor(parent: HTMLElement, simUI: IndividualSimUI<SpecType>) {
		super(parent, simUI, 'Addon Import', true);
		this.simUI = simUI;

		this.descriptionElem.innerHTML = `
			<p>
				Import settings from the <a href="https://www.curseforge.com/wow/addons/wowsimsexporter" target="_blank">WoWSims Importer In-Game Addon</a>.
			</p>
			<p>
				This feature imports gear, race, talents, glyphs, and professions. It does NOT import buffs, debuffs, consumes, rotation, or custom stats.
			</p>
			<p>
				To import, paste the output from the addon below and click, 'Import'.
			</p>
		`;
	}

	onImport(data: string) {
		const importJson = JSON.parse(data);

		// Parse all the settings.
		const charClass = nameToClass((importJson['class'] as string) || '');
		if (charClass == Class.ClassUnknown) {
			throw new Error('Could not parse Class!');
		}

		const race = nameToRace((importJson['race'] as string) || '');
		if (race == Race.RaceUnknown) {
			throw new Error('Could not parse Race!');
		}

		const professions = (importJson['professions'] as Array<{name: string, level: number}>).map(profData => nameToProfession(profData.name));
		professions.forEach((prof, i) => {
			if (prof == Profession.ProfessionUnknown) {
				throw new Error(`Could not parse profession '${importJson['professions'][i]}'`);
			}
		});

		const talentsStr = (importJson['talents'] as string) || '';

		const glyphsConfig = classGlyphsConfig[charClass];
		const majorGlyphIDs = (importJson['glyphs']['major'] as Array<string>).map(glyphName => glyphNameToID(glyphName, glyphsConfig.majorGlyphs));
		const minorGlyphIDs = (importJson['glyphs']['minor'] as Array<string>).map(glyphName => glyphNameToID(glyphName, glyphsConfig.minorGlyphs));
		const glyphs = Glyphs.create({
			major1: majorGlyphIDs[0] || 0,
			major2: majorGlyphIDs[1] || 0,
			major3: majorGlyphIDs[2] || 0,
			minor1: minorGlyphIDs[0] || 0,
			minor2: minorGlyphIDs[1] || 0,
			minor3: minorGlyphIDs[2] || 0,
		});

		const gearJson = importJson['gear'];
		gearJson.items = (gearJson.items as Array<any>).filter(item => item != null);
		(gearJson.items as Array<any>).forEach(item => {
			if (item.gems) {
				item.gems = (item.gems as Array<any>).map(gem => gem || 0);
			}
		});
		const equipmentSpec = EquipmentSpec.fromJson(gearJson);

		this.finishIndividualImport(this.simUI, charClass, race, equipmentSpec, talentsStr, glyphs, professions);
	}
}

function glyphNameToID(glyphName: string, glyphsConfig: Record<number, GlyphConfig>): number {
	if (!glyphName) {
		return 0;
	}

	for (let glyphIDStr in glyphsConfig) {
		if (glyphsConfig[glyphIDStr].name == glyphName) {
			return parseInt(glyphIDStr);
		}
	}
	throw new Error(`Unknown glyph name '${glyphName}'`);
}
