package protection

import (
	"github.com/wowsims/sod/sim/core"
	"github.com/wowsims/sod/sim/core/proto"
	"github.com/wowsims/sod/sim/warrior"
)

func RegisterProtectionWarrior() {
	core.RegisterAgentFactory(
		proto.Player_ProtectionWarrior{},
		proto.Spec_SpecProtectionWarrior,
		func(character *core.Character, options *proto.Player) core.Agent {
			return NewProtectionWarrior(character, options)
		},
		func(player *proto.Player, spec interface{}) {
			playerSpec, ok := spec.(*proto.Player_ProtectionWarrior)
			if !ok {
				panic("Invalid spec value for Protection Warrior!")
			}
			player.Spec = playerSpec
		},
	)
}

type ProtectionWarrior struct {
	*warrior.Warrior

	Options *proto.ProtectionWarrior_Options
}

func NewProtectionWarrior(character *core.Character, options *proto.Player) *ProtectionWarrior {
	warOptions := options.GetProtectionWarrior()

	war := &ProtectionWarrior{
		Warrior: warrior.NewWarrior(character, options.TalentsString, warrior.WarriorInputs{}),
		Options: warOptions.Options,
	}

	war.EnableRageBar(core.RageBarOptions{
		StartingRage:          warOptions.Options.StartingRage,
		DamageDealtMultiplier: 1,
		DamageTakenMultiplier: 1,
	})

	war.EnableAutoAttacks(war, core.AutoAttackOptions{
		MainHand:       war.WeaponFromMainHand(),
		OffHand:        war.WeaponFromOffHand(),
		AutoSwingMelee: true,
		ReplaceMHSwing: war.TryHSOrCleave,
	})

	healingModel := options.HealingModel
	if healingModel != nil {
		if healingModel.InspirationUptime > 0.0 {
			core.ApplyInspiration(war.GetCharacter(), healingModel.InspirationUptime)
		}
	}

	return war
}

func (war *ProtectionWarrior) GetWarrior() *warrior.Warrior {
	return war.Warrior
}

func (war *ProtectionWarrior) Initialize() {
	war.Warrior.Initialize()

	war.RegisterShieldWallCD()
	war.RegisterShieldBlockCD()
	war.DefensiveStanceAura.BuildPhase = core.CharacterBuildPhaseTalents
}

func (war *ProtectionWarrior) Reset(sim *core.Simulation) {
	war.Warrior.Reset(sim)
	war.DefensiveStanceAura.Activate(sim)
	war.Stance = warrior.DefensiveStance
	war.Warrior.PseudoStats.Stunned = false
}
