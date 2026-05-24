<template>
  <section class="model-hub-panel" :aria-label="copy.title">
    <div class="module-view-header">
      <div>
        <p class="eyebrow">Aggregation</p>
        <h1>{{ copy.title }}</h1>
      </div>
      <span class="status-pill online">{{ activeProfile ? `${copy.current}: ${activeProfile.name}` : copy.noModel }}</span>
    </div>

    <div class="model-hub-grid">
      <div class="model-profile-list">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">APIs</p>
            <h2>{{ copy.profilesTitle }}</h2>
          </div>
          <button class="icon-button ghost" type="button" :title="copy.newConfig" @click="newDraft">
            <Plus :size="17" />
          </button>
        </div>

        <button
          v-for="profile in profiles"
          :key="profile.id"
          class="model-profile-card"
          :class="{ active: profile.id === activeProfileId }"
          type="button"
          @click="selectProfile(profile)"
        >
          <span class="api-pet-avatar api-pet-character" :class="`api-pet-${profile.pet.species}`" aria-hidden="true">
            <img class="pet-sprite" :src="petSprite(profile.pet)" alt="" />
          </span>
          <div>
            <strong>{{ profile.name }}</strong>
            <span>{{ providerName(profile.provider) }} / {{ profile.model }}</span>
            <small>{{ profile.pet.name }} · Lv.{{ profile.pet.level }} · {{ profile.persona.temperament || copy.defaultPersonality }}</small>
          </div>
          <em>{{ profile.id === activeProfileId ? copy.inUse : copy.clickSwitch }}</em>
        </button>

        <div v-if="profiles.length === 0" class="profile-empty">
          <PlugZap :size="28" />
          <span>{{ copy.emptyProfiles }}</span>
        </div>
      </div>

      <form class="model-profile-form" @submit.prevent="saveDraft">
        <div class="panel-heading compact">
          <div>
            <p class="eyebrow">Config</p>
            <h2>{{ panelTitle }}</h2>
          </div>
        </div>

        <div v-if="draft.id" class="api-panel-switch" role="tablist" :aria-label="copy.apiWorkspace">
          <button type="button" :class="{ active: activePane === 'pet' }" @click="activePane = 'pet'">
            <HandHeart :size="16" />
            <span>{{ copy.petPanel }}</span>
          </button>
          <button type="button" :class="{ active: activePane === 'config' }" @click="activePane = 'config'">
            <KeyRound :size="16" />
            <span>{{ copy.configPanel }}</span>
          </button>
        </div>

        <div v-if="!draft.id || activePane === 'config'" class="api-life-layout is-create-mode">
          <div class="api-config-column">
            <div class="form-grid">
              <label>
                <span>{{ copy.configName }}</span>
                <input v-model="draft.name" :placeholder="copy.configNamePlaceholder" autocomplete="off" />
              </label>

              <label>
                <span>{{ copy.providerFormat }}</span>
                <select v-model="draft.provider" @change="applyProviderDefaults">
                  <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                    {{ providerName(provider.id) }}
                  </option>
                </select>
              </label>

              <label>
                <span>Base URL</span>
                <input v-model="draft.baseUrl" placeholder="https://api.example.com/v1" autocomplete="off" />
              </label>

              <label>
                <span>API Key</span>
                <div class="input-with-icon key-field">
                  <KeyRound :size="16" />
                  <input v-model="draft.apiKey" :type="showApiKey ? 'text' : 'password'" autocomplete="off" />
                  <button
                    class="visibility-toggle"
                    type="button"
                    :title="showApiKey ? copy.hideKey : copy.showKey"
                    @click="showApiKey = !showApiKey"
                  >
                    <EyeOff v-if="showApiKey" :size="16" />
                    <Eye v-else :size="16" />
                  </button>
                </div>
              </label>

              <label>
                <span>Model</span>
                <input
                  v-model="draft.model"
                  :placeholder="copy.modelPlaceholder"
                  autocomplete="off"
                  @change="saveModelChange"
                />
              </label>

              <label>
                <span>Max Tokens</span>
                <input v-model.number="draft.maxTokens" type="number" min="1" step="1" />
              </label>

              <label class="full-field">
                <span class="field-label optional">{{ copy.apiNotes }}</span>
                <textarea v-model="draft.persona.notes" rows="3" :placeholder="copy.notesPlaceholder" />
              </label>
            </div>

            <div class="range-row">
              <label for="hub-temperature">Temperature</label>
              <input id="hub-temperature" v-model.number="draft.temperature" type="range" min="0" max="2" step="0.1" />
              <output>{{ draft.temperature.toFixed(1) }}</output>
            </div>

            <section v-if="!draft.id" class="api-pet-adoption-box" :aria-label="copy.petSelectTitle">
              <div class="panel-heading compact">
                <div>
                  <p class="eyebrow">Companion</p>
                  <h2>{{ copy.petSelectTitle }}</h2>
                </div>
              </div>
              <div class="api-pet-adoption-head">
                <div class="api-pet-orb api-pet-character" :class="`api-pet-${draft.pet.species}`" aria-hidden="true">
                  <img class="pet-sprite" :src="petSprite(draft.pet)" alt="" />
                </div>
                <div>
                  <strong>{{ draft.pet.name }}</strong>
                  <span>{{ petSpeciesLabel(draft.pet.species, draft.pet.appearance) }}</span>
                  <small>{{ copy.petSelectHint }}</small>
                </div>
              </div>
              <label class="pet-name-field">
                <span>{{ copy.petName }}</span>
                <input v-model="draft.pet.name" :placeholder="copy.petNamePlaceholder" autocomplete="off" />
              </label>
              <div class="pet-personality-field">
                <span class="field-label required">{{ copy.temperament }}</span>
                <div class="persona-trait-grid" role="radiogroup" :aria-label="copy.temperament">
                  <button
                    v-for="trait in personaTraits"
                    :key="trait"
                    class="persona-trait-button"
                    :class="{ active: draft.persona.temperament === personaTraitLabel(trait) }"
                    type="button"
                    @click="draft.persona.temperament = personaTraitLabel(trait)"
                  >
                    <span>{{ personaTraitIcon(trait) }}</span>
                    <strong>{{ personaTraitLabel(trait) }}</strong>
                  </button>
                </div>
              </div>
              <div class="pixel-pet-creator" :aria-label="copy.petCreator">
                <div class="pixel-pet-preview api-pet-character" aria-hidden="true">
                  <img class="pet-sprite" :src="petSprite(draft.pet)" alt="" />
                </div>
                <div class="pixel-pet-fields">
                  <label>
                    <span>{{ copy.petSpecies }}</span>
                    <select :value="draft.pet.appearance?.animal" @change="selectPetAnimal(($event.target as HTMLSelectElement).value as PixelPetAnimal)">
                      <option v-for="animal in petAnimals" :key="animal" :value="animal">{{ petAnimalLabel(animal) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.petPattern }}</span>
                    <select v-model="draft.pet.appearance!.pattern">
                      <option v-for="pattern in petPatterns" :key="pattern" :value="pattern">{{ petPatternLabel(pattern) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.petExpression }}</span>
                    <select v-model="draft.pet.appearance!.expression">
                      <option v-for="expression in petExpressions" :key="expression" :value="expression">{{ petExpressionLabel(expression) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.petAccessory }}</span>
                    <select v-model="draft.pet.appearance!.accessory">
                      <option v-for="accessory in petAccessories" :key="accessory" :value="accessory">{{ petAccessoryLabel(accessory) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.primaryColor }}</span>
                    <input v-model="draft.pet.appearance!.primaryColor" type="color" :title="copy.primaryColor" :aria-label="copy.primaryColor" />
                  </label>
                  <label>
                    <span>{{ copy.secondaryColor }}</span>
                    <input v-model="draft.pet.appearance!.secondaryColor" type="color" :title="copy.secondaryColor" :aria-label="copy.secondaryColor" />
                  </label>
                  <label>
                    <span>{{ copy.accentColor }}</span>
                    <input v-model="draft.pet.appearance!.accentColor" type="color" :title="copy.accentColor" :aria-label="copy.accentColor" />
                  </label>
                  <button class="secondary-button compact" type="button" @click="randomizePetAppearance(draft.pet)">
                    <Sparkles :size="16" />
                    <span>{{ copy.randomPet }}</span>
                  </button>
                </div>
              </div>
            </section>
          </div>

        </div>

        <section v-if="draft.id && activePane === 'pet'" class="api-pet-page" :aria-label="copy.petTitle">
          <div class="api-pet-hero">
            <div
              class="api-pet-scene"
              :class="[
                `api-pet-scene-${draft.pet.species}`,
                petActionVisual ? `is-${petActionVisual}` : '',
                petQuestScene ? `api-pet-quest-${petQuestScene}` : '',
              ]"
            >
              <span class="api-pet-sky" />
              <span class="api-pet-landscape landscape-back" />
              <span class="api-pet-landscape landscape-mid" />
              <span class="api-pet-landscape landscape-front" />
              <span class="api-pet-sparkle sparkle-one" />
              <span class="api-pet-sparkle sparkle-two" />
              <span class="api-pet-sparkle sparkle-three" />
              <div class="api-pet-ground" />
              <div class="api-pet-orb api-pet-character" :class="`api-pet-${draft.pet.species}`" aria-hidden="true">
                <img class="pet-sprite" :src="petSprite(draft.pet)" alt="" />
              </div>
            </div>
            <div class="api-pet-stage">
              <div>
                <p class="eyebrow">Companion</p>
                <h2>{{ copy.petTitle }}</h2>
                <strong>{{ draft.pet.name }}</strong>
                <span>{{ petSpeciesLabel(draft.pet.species, draft.pet.appearance) }} · Lv.{{ draft.pet.level }}</span>
              </div>
              <button class="secondary-button compact" type="button" @click="openPetChange">
                <Sparkles :size="16" />
                <span>{{ copy.changePet }}</span>
              </button>
            </div>
          </div>

          <div class="api-pet-controls">
            <div class="pet-stat-list">
              <div class="pet-stat-row">
                <span>{{ copy.exp }}</span>
                <div><i :style="{ width: `${expProgress}%` }" /></div>
                <strong>{{ draft.pet.experience }}/{{ nextLevelExp }}</strong>
              </div>
              <div class="pet-stat-row">
                <span>{{ copy.mood }}</span>
                <div><i :style="{ width: `${draft.pet.mood}%` }" /></div>
                <strong>{{ draft.pet.mood }}</strong>
              </div>
              <div class="pet-stat-row">
                <span>{{ copy.satiety }}</span>
                <div><i :style="{ width: `${draft.pet.satiety}%` }" /></div>
                <strong>{{ draft.pet.satiety }}</strong>
              </div>
              <div class="pet-stat-row">
                <span>{{ copy.energy }}</span>
                <div><i :style="{ width: `${draft.pet.energy}%` }" /></div>
                <strong>{{ draft.pet.energy }}</strong>
              </div>
            </div>

            <div class="pet-actions">
              <button type="button" :disabled="remainingInteractions.feed <= 0" @click="interactPet('feed')">
                <Utensils :size="16" />
                <span>{{ copy.feed }} {{ remainingInteractions.feed }}/3</span>
              </button>
              <button type="button" :disabled="remainingInteractions.pet <= 0" @click="interactPet('pet')">
                <HandHeart :size="16" />
                <span>{{ copy.stroke }} {{ remainingInteractions.pet }}/3</span>
              </button>
              <button type="button" :disabled="remainingInteractions.quest <= 0" @click="openQuestPlanner">
                <Map :size="16" />
                <span>{{ copy.quest }} {{ remainingInteractions.quest }}/1</span>
              </button>
            </div>

            <section v-if="petChangeOpen" class="api-pet-adoption-box pet-change-box" :aria-label="copy.changePetTitle">
              <div class="panel-heading compact">
                <div>
                  <p class="eyebrow">Companion</p>
                  <h2>{{ copy.changePetTitle }}</h2>
                </div>
                <button class="icon-button ghost" type="button" :title="copy.cancelChangePet" @click="cancelPetChange">
                  <X :size="16" />
                </button>
              </div>
              <div class="api-pet-adoption-head">
                <div class="api-pet-orb api-pet-character" :class="`api-pet-${replacementPet.species}`" aria-hidden="true">
                  <img class="pet-sprite" :src="petSprite(replacementPet)" alt="" />
                </div>
                <div>
                  <strong>{{ replacementPet.name }}</strong>
                  <span>{{ petSpeciesLabel(replacementPet.species, replacementPet.appearance) }}</span>
                  <small>{{ copy.changePetWarning }}</small>
                </div>
              </div>
              <label class="pet-name-field">
                <span>{{ copy.petName }}</span>
                <input v-model="replacementPet.name" :placeholder="copy.petNamePlaceholder" autocomplete="off" />
              </label>
              <div class="pet-personality-field">
                <span class="field-label required">{{ copy.temperament }}</span>
                <div class="persona-trait-grid" role="radiogroup" :aria-label="copy.temperament">
                  <button
                    v-for="trait in personaTraits"
                    :key="trait"
                    class="persona-trait-button"
                    :class="{ active: replacementTemperament === personaTraitLabel(trait) }"
                    type="button"
                    @click="replacementTemperament = personaTraitLabel(trait)"
                  >
                    <span>{{ personaTraitIcon(trait) }}</span>
                    <strong>{{ personaTraitLabel(trait) }}</strong>
                  </button>
                </div>
              </div>
              <div class="pixel-pet-creator" :aria-label="copy.petCreator">
                <div class="pixel-pet-preview api-pet-character" aria-hidden="true">
                  <img class="pet-sprite" :src="petSprite(replacementPet)" alt="" />
                </div>
                <div class="pixel-pet-fields">
                  <label>
                    <span>{{ copy.petSpecies }}</span>
                    <select :value="replacementPet.appearance?.animal" @change="selectPetAnimal(($event.target as HTMLSelectElement).value as PixelPetAnimal, replacementPet)">
                      <option v-for="animal in petAnimals" :key="animal" :value="animal">{{ petAnimalLabel(animal) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.petPattern }}</span>
                    <select v-model="replacementPet.appearance!.pattern">
                      <option v-for="pattern in petPatterns" :key="pattern" :value="pattern">{{ petPatternLabel(pattern) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.petExpression }}</span>
                    <select v-model="replacementPet.appearance!.expression">
                      <option v-for="expression in petExpressions" :key="expression" :value="expression">{{ petExpressionLabel(expression) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.petAccessory }}</span>
                    <select v-model="replacementPet.appearance!.accessory">
                      <option v-for="accessory in petAccessories" :key="accessory" :value="accessory">{{ petAccessoryLabel(accessory) }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ copy.primaryColor }}</span>
                    <input v-model="replacementPet.appearance!.primaryColor" type="color" :title="copy.primaryColor" :aria-label="copy.primaryColor" />
                  </label>
                  <label>
                    <span>{{ copy.secondaryColor }}</span>
                    <input v-model="replacementPet.appearance!.secondaryColor" type="color" :title="copy.secondaryColor" :aria-label="copy.secondaryColor" />
                  </label>
                  <label>
                    <span>{{ copy.accentColor }}</span>
                    <input v-model="replacementPet.appearance!.accentColor" type="color" :title="copy.accentColor" :aria-label="copy.accentColor" />
                  </label>
                  <button class="secondary-button compact" type="button" @click="randomizePetAppearance(replacementPet)">
                    <Sparkles :size="16" />
                    <span>{{ copy.randomPet }}</span>
                  </button>
                </div>
              </div>
              <p class="pet-reset-warning">{{ copy.changePetReset }}</p>
              <div class="form-actions compact">
                <button class="secondary-button" type="button" @click="cancelPetChange">
                  <span>{{ copy.cancelChangePet }}</span>
                </button>
                <button class="primary-action compact" type="button" :disabled="!canConfirmPetChange" @click="confirmPetChange">
                  <Save :size="16" />
                  <span>{{ copy.confirmChangePet }}</span>
                </button>
              </div>
            </section>

            <section v-if="questPlannerOpen" class="pet-quest-planner" :aria-label="copy.questPlanner">
              <div class="pet-quest-head">
                <div>
                  <p class="eyebrow">Route</p>
                  <strong>{{ copy.questPlanner }}</strong>
                </div>
                <button
                  class="secondary-button compact"
                  type="button"
                  :class="{ complete: petQuestScene === selectedQuestScene && remainingInteractions.quest <= 0 }"
                  :disabled="remainingInteractions.quest <= 0"
                  @click="confirmQuest"
                >
                  <Map :size="16" />
                  <span>{{ petQuestScene === selectedQuestScene && remainingInteractions.quest <= 0 ? copy.questArrived : copy.confirmQuest }}</span>
                </button>
              </div>

              <div class="pet-quest-content">
                <div class="pet-quest-destinations" role="radiogroup" :aria-label="copy.questScene">
                  <button
                    v-for="scene in questScenes"
                    :key="scene"
                    class="pet-quest-card"
                    :class="[`api-pet-quest-${scene}`, { active: selectedQuestScene === scene }]"
                    type="button"
                    @click="selectedQuestScene = scene"
                  >
                    <span class="pet-weather-icon" aria-hidden="true">{{ questSceneMeta(scene).icon }}</span>
                    <strong>{{ questSceneMeta(scene).name }}</strong>
                    <small>{{ questSceneMeta(scene).weather }}</small>
                    <em>{{ questSceneMeta(scene).risk }}</em>
                  </button>
                </div>

                <div
                  class="pet-quest-map"
                  :class="[`api-pet-quest-${selectedQuestScene}`, petQuestScene === selectedQuestScene ? 'is-arrived' : '']"
                  aria-hidden="true"
                >
                  <span class="api-pet-sky" />
                  <span class="quest-map-weather-layer" />
                  <span class="api-pet-landscape landscape-back" />
                  <span class="api-pet-landscape landscape-mid" />
                  <span class="api-pet-landscape landscape-front" />
                  <span class="quest-map-feature feature-one" />
                  <span class="quest-map-feature feature-two" />
                  <span class="quest-map-feature feature-three" />
                  <span class="quest-map-route route-one" />
                  <span class="quest-map-route route-two" />
                  <span class="quest-map-node node-start" />
                  <span class="quest-map-node node-end" />
                  <span class="quest-map-pin" />
                  <span class="quest-map-weather-card">
                    <span>{{ questSceneMeta(selectedQuestScene).icon }}</span>
                    <strong>{{ questSceneMeta(selectedQuestScene).name }}</strong>
                    <small>{{ questSceneMeta(selectedQuestScene).weather }}</small>
                  </span>
                  <span v-if="petQuestScene === selectedQuestScene" class="quest-map-pet api-pet-character" :class="`api-pet-${draft.pet.species}`">
                    <img class="pet-sprite" :src="petSprite(draft.pet)" alt="" />
                  </span>
                </div>
              </div>
            </section>

            <p class="pet-status-line">{{ draft.pet.lastAction || copy.petIdle }}</p>
          </div>
        </section>

        <p v-if="notice" class="notice-line">{{ notice }}</p>

        <div v-if="!draft.id || activePane === 'config'" class="form-actions">
          <button class="primary-action" type="button" :disabled="!canSave" @click="saveDraft">
            <Save :size="18" />
            <span>{{ copy.saveConfig }}</span>
          </button>
          <button class="secondary-button" type="button" :disabled="testing" @click="testConnection">
            <PlugZap :size="17" />
            <span>{{ testing ? copy.testing : copy.testConnection }}</span>
          </button>
          <button class="secondary-button" type="button" :disabled="loadingModels" @click="loadModels">
            <ListRestart :size="17" />
            <span>{{ loadingModels ? copy.loadingModels : copy.fetchModels }}</span>
          </button>
          <button v-if="draft.id" class="secondary-button danger" type="button" @click="openDeleteConfirm">
            <Trash2 :size="17" />
            <span>{{ copy.delete }}</span>
          </button>
        </div>

        <p v-if="connectionError" class="error-line inline">{{ connectionError }}</p>

        <div v-if="(!draft.id || activePane === 'config') && modelOptions.length" class="model-options" :aria-label="copy.modelList">
          <button
            v-for="model in modelOptions"
            :key="model.id"
            class="model-option"
            type="button"
            @click="selectModelOption(model.id)"
          >
            <strong>{{ model.id }}</strong>
            <span>{{ model.label }}</span>
          </button>
        </div>
      </form>

      <div v-if="deleteConfirmOpen" class="delete-confirm-backdrop" @click.self="closeDeleteConfirm">
        <div class="delete-confirm-dialog" role="dialog" aria-modal="true" :aria-label="copy.deleteConfirmTitle">
          <div class="delete-confirm-head">
            <div>
              <p class="eyebrow">Companion</p>
              <strong>{{ copy.deleteConfirmTitle }}</strong>
            </div>
            <button class="icon-button ghost" type="button" :title="copy.cancelDelete" @click="closeDeleteConfirm">
              <X :size="16" />
            </button>
          </div>
          <div class="delete-confirm-body">
            <div class="delete-confirm-pet">
              <div class="api-pet-orb api-pet-character" :class="`api-pet-${draft.pet.species}`" aria-hidden="true">
                <img class="pet-sprite" :src="petSprite(draft.pet)" alt="" />
              </div>
              <div class="delete-confirm-bubble">
                <p>{{ deleteRetainText }}</p>
              </div>
            </div>
            <p class="delete-confirm-text">{{ copy.deleteConfirmBody }}</p>
          </div>
          <div class="delete-confirm-actions">
            <button class="secondary-button" type="button" @click="closeDeleteConfirm">
              <span>{{ copy.cancelDelete }}</span>
            </button>
            <button class="secondary-button danger" type="button" @click="confirmDeleteDraft">
              <span>{{ copy.confirmDelete }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  Eye,
  EyeOff,
  HandHeart,
  KeyRound,
  ListRestart,
  Map,
  PlugZap,
  Plus,
  Save,
  Sparkles,
  X,
  Trash2,
  Utensils,
} from "lucide-vue-next";

import { fetchProviderModels, testProviderConnection } from "../services/api";
import type { ApiPet, ChatConfig, ModelProfile, PixelPetAppearance, ProviderFormat, ProviderInfo, ProviderModel } from "../types/chat";

const props = defineProps<{
  profiles: ModelProfile[];
  activeProfileId: string;
  providers: ProviderInfo[];
  currentConfig: ChatConfig;
  language: "zh-CN" | "en-US";
}>();

const emit = defineEmits<{
  save: [profile: ModelProfile];
  select: [profile: ModelProfile];
  delete: [profileId: string];
}>();

type DraftProfile = ModelProfile;
type PetAction = "feed" | "pet" | "quest";
type PetQuestScene = "glacier" | "forest" | "desert" | "ocean" | "canyon" | "aurora";
type PersonaTrait = "gentle" | "lively" | "calm" | "strict" | "curious" | "witty";
type PixelPetAnimal = PixelPetAppearance["animal"];
type PixelPetPattern = PixelPetAppearance["pattern"];
type PixelPetExpression = PixelPetAppearance["expression"];
type PixelPetAccessory = PixelPetAppearance["accessory"];

const petSpecies: ApiPet["species"][] = ["spark", "leaf", "stone", "cloud", "cat", "dog", "rabbit", "panda", "fox", "bird", "penguin", "hamster", "turtle"];
const questScenes: PetQuestScene[] = ["glacier", "forest", "desert", "ocean", "canyon", "aurora"];
const personaTraits: PersonaTrait[] = ["gentle", "lively", "calm", "strict", "curious", "witty"];
const petAnimals: PixelPetAnimal[] = ["cat", "dog", "rabbit", "panda", "fox", "bird", "penguin", "hamster", "turtle"];
const petPatterns: PixelPetPattern[] = ["solid", "spots", "mask", "socks", "split"];
const petExpressions: PixelPetExpression[] = ["bright", "happy", "sleepy", "cool"];
const petAccessories: PixelPetAccessory[] = ["none", "scarf", "bell", "leaf", "satchel"];
const petPalettePresets = [
  ["#f2d4a5", "#8a5638", "#e05f4f"],
  ["#f7f0dc", "#2e3433", "#5fbf8f"],
  ["#d78552", "#ffffff", "#3e8fd8"],
  ["#a9c96d", "#fff2b5", "#d95f5f"],
  ["#77b4d8", "#f8f4e8", "#e8b84d"],
  ["#c7b7ff", "#f7edf2", "#79c27b"],
] as const;
const draft = reactive<DraftProfile>(emptyDraft());
const notice = ref("");
const replacementPet = reactive<ApiPet>(defaultPet());
const replacementTemperament = ref("");
const showApiKey = ref(false);
const testing = ref(false);
const loadingModels = ref(false);
const connectionError = ref("");
const modelOptions = ref<ProviderModel[]>([]);
const activePane = ref<"config" | "pet">("config");
const petActionVisual = ref<PetAction | "">("");
const petQuestScene = ref<PetQuestScene | "">("");
const selectedQuestScene = ref<PetQuestScene>("forest");
const questPlannerOpen = ref(false);
const deleteConfirmOpen = ref(false);
const petChangeOpen = ref(false);
let petActionTimer = 0;
let petPersistTimer = 0;

const activeProfile = computed(() => props.profiles.find((profile) => profile.id === props.activeProfileId));
const canSave = computed(() =>
  Boolean(
    draft.name.trim()
      && draft.baseUrl.trim()
      && draft.apiKey.trim()
      && draft.model.trim()
  ),
);
const nextLevelExp = computed(() => levelRequirement(draft.pet.level));
const expProgress = computed(() => Math.min(100, Math.round((draft.pet.experience / nextLevelExp.value) * 100)));
const canConfirmPetChange = computed(() => Boolean(replacementPet.name.trim() && replacementTemperament.value.trim()));
const remainingInteractions = computed(() => {
  refreshDailyInteractions(draft.pet);
  return {
    feed: Math.max(0, dailyActionLimit("feed") - draft.pet.dailyFeedCount),
    pet: Math.max(0, dailyActionLimit("pet") - draft.pet.dailyPetCount),
    quest: Math.max(0, dailyActionLimit("quest") - draft.pet.dailyQuestCount),
  };
});
const copy = computed(() =>
  props.language === "en-US"
    ? {
        title: "Aggregation",
        current: "Current",
        noModel: "No API selected",
        profilesTitle: "API profiles",
        newConfig: "New API",
        inUse: "In use",
        clickSwitch: "Switch",
        emptyProfiles: "No API profiles yet",
        editConfig: "Edit API",
        addConfig: "Add API",
        configName: "API name",
        configNamePlaceholder: "Example: OpenAI production",
        providerFormat: "Provider format",
        hideKey: "Hide key",
        showKey: "Show key",
        modelPlaceholder: "Model name",
        saveConfig: "Save API",
        testing: "Testing",
        testConnection: "Test connection",
        loadingModels: "Fetching",
        fetchModels: "Fetch models",
        delete: "Delete",
        modelList: "Model list",
        switched: "Switched to",
        saved: "Saved and switched to",
        deleted: "API deleted",
        testFailed: "Connection test failed",
        fetched: "Fetched",
        models: "models",
        noModels: "Connection is healthy, but no models were returned",
        fetchFailed: "Failed to fetch models",
        temperament: "Personality",
        apiNotes: "Notes",
        notesPlaceholder: "Optional: usage scenarios, limits, cost notes...",
        defaultPersonality: "No personality",
        petTitle: "API pet",
        petName: "Pet name",
        petNamePlaceholder: "Example: Byte",
        petSpecies: "Pet species",
        petCreator: "Pixel pet creator",
        petPattern: "Pattern",
        petExpression: "Expression",
        petAccessory: "Accessory",
        primaryColor: "Main color",
        secondaryColor: "Patch color",
        accentColor: "Accent",
        randomPet: "Randomize",
        exp: "EXP",
        mood: "Mood",
        satiety: "Food",
        energy: "Energy",
        feed: "Feed",
        stroke: "Pet",
        quest: "Quest",
        petIdle: "The pet is waiting beside this API.",
        levelUp: "leveled up",
        dailyLimitReached: "Daily limit reached. It refreshes at midnight.",
        apiWorkspace: "API workspace",
        petPanel: "Pet",
        configPanel: "Config",
        questPlanner: "Choose a destination",
        questScene: "Quest destination",
        confirmQuest: "Confirm trip",
        questArrived: "Arrived",
        petSelectTitle: "Choose a pet",
        petSelectHint: "This pet will stay with the API after it is saved.",
        deleteConfirmTitle: "Delete this API?",
        deleteConfirmBody: "Deleting the API will also delete its companion and all pet state.",
        cancelDelete: "Cancel",
        confirmDelete: "Delete",
        changePet: "Change pet",
        changePetTitle: "Change pet",
        changePetWarning: "Changing pets will reset level, EXP, stats, daily interactions, and recent pet status.",
        changePetReset: "After confirming, this pet starts from Lv.1 with 0 EXP.",
        cancelChangePet: "Cancel",
        confirmChangePet: "Confirm change",
      }
    : {
        title: "聚合",
        current: "当前",
        noModel: "未选择 API",
        profilesTitle: "API 配置",
        newConfig: "新建 API",
        inUse: "使用中",
        clickSwitch: "切换",
        emptyProfiles: "还没有 API 配置",
        editConfig: "编辑 API",
        addConfig: "新增 API",
        configName: "API 名称",
        configNamePlaceholder: "例如：OpenAI 生产环境",
        providerFormat: "模型格式",
        hideKey: "隐藏 Key",
        showKey: "显示 Key",
        modelPlaceholder: "模型名称",
        saveConfig: "保存 API",
        testing: "测试中",
        testConnection: "测试连接",
        loadingModels: "获取中",
        fetchModels: "获取模型",
        delete: "删除",
        modelList: "模型列表",
        switched: "已切换到",
        saved: "已保存并切换到",
        deleted: "API 已删除",
        testFailed: "连接测试失败",
        fetched: "已获取",
        models: "个模型",
        noModels: "连接正常，但没有返回模型",
        fetchFailed: "获取模型失败",
        temperament: "性格",
        apiNotes: "备注",
        notesPlaceholder: "选填：适合场景、限制、成本提醒...",
        defaultPersonality: "未设置性格",
        petTitle: "API 宠物",
        petName: "宠物名",
        petNamePlaceholder: "例如：比特",
        petSpecies: "宠物类型",
        petCreator: "像素宠物生成器",
        petPattern: "花纹",
        petExpression: "表情",
        petAccessory: "配饰",
        primaryColor: "主色",
        secondaryColor: "拼色",
        accentColor: "点缀",
        randomPet: "随机生成",
        exp: "经验",
        mood: "心情",
        satiety: "饱食",
        energy: "精力",
        feed: "喂食",
        stroke: "抚摸",
        quest: "历练",
        petIdle: "宠物正在这个 API 旁边待命。",
        levelUp: "升级了",
        dailyLimitReached: "今日次数已用完，凌晨 0 点刷新。",
        apiWorkspace: "API 工作区",
        petPanel: "宠物",
        configPanel: "配置",
        questPlanner: "选择历练地点",
        questScene: "历练地点",
        confirmQuest: "确认前往",
        questArrived: "已抵达",
        petSelectTitle: "选择宠物",
        petSelectHint: "保存后，这只宠物会绑定到当前 API。",
        deleteConfirmTitle: "确定删除这个 API 吗？",
        deleteConfirmBody: "删除 API 的同时，也会删除它绑定的宠物和全部状态。",
        cancelDelete: "取消",
        confirmDelete: "确认删除",
        changePet: "更换宠物",
        changePetTitle: "更换宠物",
        changePetWarning: "更换宠物会重置等级、经验、状态、每日互动次数和最近宠物动态。",
        changePetReset: "确认后，新宠物会从 Lv.1、0 经验重新开始。",
        cancelChangePet: "取消",
        confirmChangePet: "确认更换",
      },
);
const panelTitle = computed(() => {
  if (!draft.id) {
    return copy.value.addConfig;
  }
  return activePane.value === "pet" ? copy.value.petTitle : copy.value.editConfig;
});
const deleteRetainText = computed(() => {
  if (props.language === "en-US") {
    return `${draft.pet.name || defaultPetName()} still wants to stay with this API. Delete it only if this profile is no longer needed.`;
  }
  return `${draft.pet.name || defaultPetName()}还想继续守着这个 API。如果它真的不再需要了，再和我告别吧。`;
});

watch(
  () => props.profiles,
  () => {
    if (!draft.id && props.profiles.length === 0) {
      Object.assign(draft, emptyDraft());
      return;
    }
    syncActiveProfileDraft();
  },
  { deep: true, immediate: true },
);

watch(
  () => props.activeProfileId,
  () => {
    syncActiveProfileDraft();
  },
  { immediate: true },
);

function syncActiveProfileDraft() {
  if (draft.id || activePane.value !== "config") {
    return;
  }
  const profile = activeProfile.value;
  if (!profile) {
    return;
  }
  Object.assign(draft, cloneProfile(normalizeProfile(profile)));
  activePane.value = "pet";
}

function selectProfile(profile: ModelProfile) {
  Object.assign(draft, cloneProfile(normalizeProfile(profile)));
  emit("select", normalizeProfile(profile));
  activePane.value = "pet";
  petQuestScene.value = "";
  questPlannerOpen.value = false;
  deleteConfirmOpen.value = false;
  petChangeOpen.value = false;
  modelOptions.value = [];
  connectionError.value = "";
  notice.value = `${copy.value.switched} ${profile.name}`;
}

function saveDraft() {
  const wasNew = !draft.id;
  const saved = persistDraft();
  if (!saved) {
    return;
  }
  if (wasNew) {
    activePane.value = "pet";
  }
}

function selectModelOption(modelId: string) {
  draft.model = modelId;
  saveModelChange();
}

function saveModelChange() {
  if (!draft.id) {
    return;
  }
  persistDraft();
}

function persistDraft() {
  if (!canSave.value) {
    return null;
  }
  const profile = profileFromDraft();
  Object.assign(draft, cloneProfile(profile));
  emit("save", profile);
  emit("select", profile);
  notice.value = `${copy.value.saved} ${profile.name}`;
  return profile;
}

function openDeleteConfirm() {
  if (!draft.id) {
    return;
  }
  deleteConfirmOpen.value = true;
}

function closeDeleteConfirm() {
  deleteConfirmOpen.value = false;
}

function confirmDeleteDraft() {
  const deletedId = draft.id;
  if (!deletedId) {
    return;
  }
  deleteConfirmOpen.value = false;
  emit("delete", deletedId);
  Object.assign(draft, emptyDraft());
  activePane.value = "config";
  petChangeOpen.value = false;
  notice.value = copy.value.deleted;
}

function newDraft() {
  Object.assign(draft, emptyDraft());
  activePane.value = "config";
  petQuestScene.value = "";
  questPlannerOpen.value = false;
  deleteConfirmOpen.value = false;
  petChangeOpen.value = false;
  modelOptions.value = [];
  connectionError.value = "";
  notice.value = "";
}

function applyProviderDefaults() {
  const provider = props.providers.find((item) => item.id === draft.provider);
  if (!provider) {
    return;
  }
  draft.baseUrl = provider.default_base_url;
  draft.model = provider.default_model;
  if (!draft.name.trim()) {
    draft.name = providerName(provider.id);
  }
}

function interactPet(action: PetAction) {
  refreshDailyInteractions(draft.pet);
  if (remainingInteractions.value[action] <= 0) {
    draft.pet.lastAction = copy.value.dailyLimitReached;
    return;
  }
  const questScene = action === "quest" ? selectedQuestScene.value : "";
  if (action === "quest") {
    petQuestScene.value = selectedQuestScene.value;
    questPlannerOpen.value = true;
  }
  triggerPetVisual(action);
  const result = petActionResult(action, questScene);
  incrementDailyAction(action);
  draft.pet.mood = clampStat(draft.pet.mood + result.mood);
  draft.pet.satiety = clampStat(draft.pet.satiety + result.satiety);
  draft.pet.energy = clampStat(draft.pet.energy + result.energy);
  draft.pet.experience += result.exp;
  const leveled = settleLevelUps(draft.pet);
  draft.pet.lastActionAt = new Date().toISOString();
  draft.pet.lastAction = leveled
    ? `${result.message}，${draft.pet.name}${copy.value.levelUp} Lv.${draft.pet.level}`
    : result.message;
  if (draft.id && canSave.value) {
    emit("save", profileFromDraft());
  } else {
    notice.value = copy.value.saveConfig;
  }
}

function persistPetDraft() {
  window.clearTimeout(petPersistTimer);
  if (!draft.id || !canSave.value) {
    return;
  }
  emit("save", profileFromDraft());
}

function schedulePetPersist() {
  window.clearTimeout(petPersistTimer);
  petPersistTimer = window.setTimeout(persistPetDraft, 450);
}

function selectPetSpecies(species: ApiPet["species"]) {
  if (draft.id) {
    return;
  }
  draft.pet.species = species;
  draft.pet.appearance = defaultPetAppearance(species);
}

function selectPetAnimal(animal: PixelPetAnimal, target: ApiPet = draft.pet) {
  target.species = animal;
  target.appearance = {
    ...normalizePetAppearance(target.appearance, animal),
    animal,
  };
}

function randomizePetAppearance(target: ApiPet = draft.pet) {
  const animal = petAnimals[Math.floor(Math.random() * petAnimals.length)];
  const [primaryColor, secondaryColor, accentColor] = petPalettePresets[Math.floor(Math.random() * petPalettePresets.length)];
  target.species = animal;
  target.appearance = {
    animal,
    primaryColor,
    secondaryColor,
    accentColor,
    pattern: petPatterns[Math.floor(Math.random() * petPatterns.length)],
    expression: petExpressions[Math.floor(Math.random() * petExpressions.length)],
    accessory: petAccessories[Math.floor(Math.random() * petAccessories.length)],
  };
}

function openPetChange() {
  Object.assign(replacementPet, {
    ...resetPetProgress(draft.pet),
    name: draft.pet.name || defaultPetName(),
    species: draft.pet.species,
    appearance: normalizePetAppearance(draft.pet.appearance, draft.pet.species),
  });
  replacementTemperament.value = draft.persona.temperament || personaTraitLabel("gentle");
  petChangeOpen.value = true;
  questPlannerOpen.value = false;
}

function cancelPetChange() {
  petChangeOpen.value = false;
}

function confirmPetChange() {
  if (!canConfirmPetChange.value || !draft.id || !canSave.value) {
    return;
  }
  draft.pet = resetPetProgress({
    ...replacementPet,
    name: replacementPet.name.trim() || defaultPetName(),
    species: replacementPet.species,
    appearance: normalizePetAppearance(replacementPet.appearance, replacementPet.species),
  });
  draft.persona.temperament = replacementTemperament.value.trim();
  petChangeOpen.value = false;
  persistDraft();
}

function resetPetProgress(pet: ApiPet): ApiPet {
  return normalizePet({
    name: pet.name,
    species: pet.species,
    appearance: normalizePetAppearance(pet.appearance, pet.species),
    level: 1,
    experience: 0,
    mood: 72,
    satiety: 68,
    energy: 76,
    lastAction: copy.value.changePetReset,
    lastActionAt: new Date().toISOString(),
    dailyInteractionDate: todayKey(),
    dailyFeedCount: 0,
    dailyPetCount: 0,
    dailyQuestCount: 0,
  });
}

function selectPetPersonality(trait: PersonaTrait) {
  draft.persona.temperament = personaTraitLabel(trait);
  schedulePetPersist();
}

function openQuestPlanner() {
  refreshDailyInteractions(draft.pet);
  if (remainingInteractions.value.quest <= 0) {
    draft.pet.lastAction = copy.value.dailyLimitReached;
    return;
  }
  questPlannerOpen.value = !questPlannerOpen.value;
  if (!selectedQuestScene.value) {
    selectedQuestScene.value = "forest";
  }
}

function confirmQuest() {
  interactPet("quest");
}

function triggerPetVisual(action: PetAction) {
  window.clearTimeout(petActionTimer);
  petActionVisual.value = action;
  petActionTimer = window.setTimeout(() => {
    petActionVisual.value = "";
  }, 900);
}

async function testConnection() {
  connectionError.value = "";
  notice.value = "";
  testing.value = true;

  try {
    const response = await testProviderConnection(draftToChatConfig());
    notice.value = `${response.message} 共 ${response.model_count} 个模型。`;
  } catch (cause) {
    connectionError.value = cause instanceof Error ? cause.message : copy.value.testFailed;
  } finally {
    testing.value = false;
  }
}

async function loadModels() {
  connectionError.value = "";
  notice.value = "";
  loadingModels.value = true;

  try {
    const response = await fetchProviderModels(draftToChatConfig());
    modelOptions.value = response.models;
    notice.value = response.models.length
      ? `${copy.value.fetched} ${response.models.length} ${copy.value.models}`
      : copy.value.noModels;
  } catch (cause) {
    connectionError.value = cause instanceof Error ? cause.message : copy.value.fetchFailed;
  } finally {
    loadingModels.value = false;
  }
}

function draftToChatConfig(): ChatConfig {
  return {
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    model: draft.model || "placeholder",
    systemPrompt: props.currentConfig.systemPrompt,
    temperature: draft.temperature,
    maxTokens: draft.maxTokens,
  };
}

function profileFromDraft(): ModelProfile {
  return normalizeProfile({
    ...draft,
    id: draft.id || createId(),
    name: draft.name.trim(),
    model: draft.model.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    persona: {
      alias: draft.persona.alias.trim(),
      role: draft.persona.role.trim(),
      temperament: draft.persona.temperament.trim(),
      notes: draft.persona.notes.trim(),
    },
    pet: {
      ...draft.pet,
      name: draft.pet.name.trim() || defaultPetName(),
    },
  });
}

function emptyDraft(): DraftProfile {
  const provider = props.providers.find((item) => item.id === props.currentConfig.provider);
  return normalizeProfile({
    id: "",
    name: "",
    provider: props.currentConfig.provider,
    baseUrl: props.currentConfig.baseUrl || provider?.default_base_url || "",
    apiKey: props.currentConfig.apiKey,
    model: props.currentConfig.model || provider?.default_model || "",
    temperature: props.currentConfig.temperature,
    maxTokens: props.currentConfig.maxTokens,
    persona: defaultPersona(),
    pet: defaultPet(),
  });
}

function normalizeProfile(raw: Partial<ModelProfile> & Pick<ModelProfile, "provider">): ModelProfile {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    provider: raw.provider,
    baseUrl: raw.baseUrl ?? "",
    apiKey: raw.apiKey ?? "",
    model: raw.model ?? "",
    temperature: Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : 0.7,
    maxTokens: Number.isFinite(Number(raw.maxTokens)) ? Number(raw.maxTokens) : 1024,
    persona: {
      ...defaultPersona(),
      ...(raw.persona ?? {}),
    },
    pet: normalizePet(raw.pet),
  };
}

function normalizePet(raw?: Partial<ApiPet>): ApiPet {
  const fallback = defaultPet();
  const species = petSpecies.includes(raw?.species as ApiPet["species"]) ? raw?.species as ApiPet["species"] : fallback.species;
  const appearance = normalizePetAppearance(raw?.appearance, species);
  const pet = {
    ...fallback,
    ...raw,
    name: raw?.name?.trim() || fallback.name,
    species,
    appearance,
    level: Math.max(1, Math.floor(Number(raw?.level) || fallback.level)),
    experience: Math.max(0, Math.floor(Number(raw?.experience) || fallback.experience)),
    mood: clampStat(Number(raw?.mood) || fallback.mood),
    satiety: clampStat(Number(raw?.satiety) || fallback.satiety),
    energy: clampStat(Number(raw?.energy) || fallback.energy),
    dailyInteractionDate: raw?.dailyInteractionDate || todayKey(),
    dailyFeedCount: Math.max(0, Math.floor(Number(raw?.dailyFeedCount) || 0)),
    dailyPetCount: Math.max(0, Math.floor(Number(raw?.dailyPetCount) || 0)),
    dailyQuestCount: Math.max(0, Math.floor(Number(raw?.dailyQuestCount) || 0)),
  };
  refreshDailyInteractions(pet);
  return pet;
}

function cloneProfile(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    persona: { ...profile.persona },
    pet: { ...profile.pet },
  };
}

function defaultPersona() {
  return {
    alias: "",
    role: "",
    temperament: "",
    notes: "",
  };
}

function defaultPet(): ApiPet {
  const species: ApiPet["species"] = "panda";
  return {
    name: defaultPetName(),
    species,
    appearance: defaultPetAppearance(species),
    level: 1,
    experience: 0,
    mood: 72,
    satiety: 68,
    energy: 76,
    lastAction: "",
    dailyInteractionDate: todayKey(),
    dailyFeedCount: 0,
    dailyPetCount: 0,
    dailyQuestCount: 0,
  };
}

function defaultPetName() {
  return props.language === "en-US" ? "Byte" : "比特";
}

function defaultPetAppearance(species: ApiPet["species"] = "panda"): PixelPetAppearance {
  const animal = speciesToAnimal(species);
  const palette: Record<PixelPetAnimal, Pick<PixelPetAppearance, "primaryColor" | "secondaryColor" | "accentColor" | "pattern">> = {
    cat: { primaryColor: "#d88954", secondaryColor: "#fff0cb", accentColor: "#4e7fd1", pattern: "socks" },
    dog: { primaryColor: "#b87848", secondaryColor: "#f2d7a7", accentColor: "#d9504f", pattern: "spots" },
    rabbit: { primaryColor: "#f3eadc", secondaryColor: "#a8c96b", accentColor: "#ef8ca8", pattern: "split" },
    panda: { primaryColor: "#f6f1e6", secondaryColor: "#252b29", accentColor: "#63b98d", pattern: "mask" },
    fox: { primaryColor: "#d96e37", secondaryColor: "#fff2d5", accentColor: "#4f8fd8", pattern: "split" },
    bird: { primaryColor: "#6eb4d9", secondaryColor: "#f7efd8", accentColor: "#e6b845", pattern: "solid" },
    penguin: { primaryColor: "#28313a", secondaryColor: "#f6f0df", accentColor: "#f0a83b", pattern: "mask" },
    hamster: { primaryColor: "#d5a15e", secondaryColor: "#ffe0aa", accentColor: "#7dc282", pattern: "spots" },
    turtle: { primaryColor: "#5f8c58", secondaryColor: "#b7c779", accentColor: "#e0a94c", pattern: "socks" },
  };
  return {
    animal,
    ...palette[animal],
    expression: "bright",
    accessory: animal === "panda" ? "leaf" : "none",
  };
}

function normalizePetAppearance(raw?: Partial<PixelPetAppearance>, species: ApiPet["species"] = "panda"): PixelPetAppearance {
  const fallback = defaultPetAppearance(species);
  const animal = raw?.animal && petAnimals.includes(raw.animal) ? raw.animal : fallback.animal;
  return {
    animal,
    primaryColor: normalizeHexColor(raw?.primaryColor, fallback.primaryColor),
    secondaryColor: normalizeHexColor(raw?.secondaryColor, fallback.secondaryColor),
    accentColor: normalizeHexColor(raw?.accentColor, fallback.accentColor),
    pattern: raw?.pattern && petPatterns.includes(raw.pattern) ? raw.pattern : fallback.pattern,
    expression: raw?.expression && petExpressions.includes(raw.expression) ? raw.expression : fallback.expression,
    accessory: raw?.accessory && petAccessories.includes(raw.accessory) ? raw.accessory : fallback.accessory,
  };
}

function normalizeHexColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function speciesToAnimal(species: ApiPet["species"]): PixelPetAnimal {
  const legacy: Record<"spark" | "leaf" | "stone" | "cloud", PixelPetAnimal> = {
    spark: "panda",
    leaf: "rabbit",
    stone: "turtle",
    cloud: "bird",
  };
  if (species in legacy) {
    return legacy[species as keyof typeof legacy];
  }
  return petAnimals.includes(species as PixelPetAnimal) ? species as PixelPetAnimal : "panda";
}

function personaTraitLabel(trait: PersonaTrait) {
  const zh: Record<PersonaTrait, string> = {
    gentle: "温柔",
    lively: "活泼",
    calm: "沉稳",
    strict: "严谨",
    curious: "好奇",
    witty: "机灵",
  };
  const en: Record<PersonaTrait, string> = {
    gentle: "Gentle",
    lively: "Lively",
    calm: "Calm",
    strict: "Strict",
    curious: "Curious",
    witty: "Witty",
  };
  return props.language === "en-US" ? en[trait] : zh[trait];
}

function personaTraitIcon(trait: PersonaTrait) {
  const icons: Record<PersonaTrait, string> = {
    gentle: "G",
    lively: "L",
    calm: "C",
    strict: "S",
    curious: "?",
    witty: "W",
  };
  return icons[trait];
}

function petActionResult(action: PetAction, questScene: PetQuestScene | "") {
  const messages = {
    feed: props.language === "en-US" ? `${draft.pet.name} enjoyed a small energy meal` : `${draft.pet.name}吃掉了一份能量餐`,
    pet: props.language === "en-US" ? `${draft.pet.name} leaned closer after being petted` : `${draft.pet.name}被抚摸后靠近了一点`,
    quest: questMessage(questScene),
  };
  if (action === "feed") {
    return { exp: 10, mood: 5, satiety: 22, energy: 8, message: messages.feed };
  }
  if (action === "pet") {
    return { exp: 8, mood: 18, satiety: -3, energy: 2, message: messages.pet };
  }
  return { exp: 26, mood: -4, satiety: -10, energy: -18, message: messages.quest };
}

function questMessage(scene: PetQuestScene | "") {
  const sceneCopy: Record<PetQuestScene, { zh: string; en: string }> = {
    glacier: {
      zh: `${draft.pet.name}穿过蓝白冰川，带回了一枚发光的冰晶数据核`,
      en: `${draft.pet.name} crossed a blue glacier and brought back a glowing ice-core token`,
    },
    forest: {
      zh: `${draft.pet.name}进入原始森林，在潮湿树影里找到了古老的接口回声`,
      en: `${draft.pet.name} entered a primeval forest and found an old API echo under the wet canopy`,
    },
    desert: {
      zh: `${draft.pet.name}横穿金色沙漠，从风化石碑上拓下了一段路线密钥`,
      en: `${draft.pet.name} crossed a golden desert and copied a route key from a weathered monolith`,
    },
    ocean: {
      zh: `${draft.pet.name}潜入深海断层，捞起了一串安静发光的模型碎片`,
      en: `${draft.pet.name} dove into a deep-sea trench and recovered a quiet glowing model shard`,
    },
    canyon: {
      zh: `${draft.pet.name}沿红岩峡谷巡游，在回声里校准了下一次调用`,
      en: `${draft.pet.name} patrolled a red-rock canyon and tuned the next request through the echo`,
    },
    aurora: {
      zh: `${draft.pet.name}抵达极光雪原，把一束绿色信号带回了工作台`,
      en: `${draft.pet.name} reached an aurora snowfield and carried a green signal back to the desk`,
    },
  };
  const fallback = scene || "forest";
  return props.language === "en-US" ? sceneCopy[fallback].en : sceneCopy[fallback].zh;
}

function questSceneMeta(scene: PetQuestScene) {
  const meta: Record<PetQuestScene, { zh: string; en: string; weatherZh: string; weatherEn: string; riskZh: string; riskEn: string; icon: string }> = {
    glacier: {
      zh: "蓝白冰川",
      en: "Blue Glacier",
      weatherZh: "低温 / 冰雾",
      weatherEn: "Freezing / ice fog",
      riskZh: "精力 -18",
      riskEn: "Energy -18",
      icon: "❄",
    },
    forest: {
      zh: "原始森林",
      en: "Primeval Forest",
      weatherZh: "潮湿 / 树影",
      weatherEn: "Humid / canopy",
      riskZh: "饱食 -10",
      riskEn: "Food -10",
      icon: "☘",
    },
    desert: {
      zh: "金色沙漠",
      en: "Golden Desert",
      weatherZh: "热浪 / 风沙",
      weatherEn: "Heat / sandstorm",
      riskZh: "心情 -4",
      riskEn: "Mood -4",
      icon: "☀",
    },
    ocean: {
      zh: "深海断层",
      en: "Deep Trench",
      weatherZh: "水压 / 暗流",
      weatherEn: "Pressure / current",
      riskZh: "精力 -18",
      riskEn: "Energy -18",
      icon: "≈",
    },
    canyon: {
      zh: "红岩峡谷",
      en: "Red Canyon",
      weatherZh: "干燥 / 回声",
      weatherEn: "Dry / echoes",
      riskZh: "饱食 -10",
      riskEn: "Food -10",
      icon: "△",
    },
    aurora: {
      zh: "极光雪原",
      en: "Aurora Field",
      weatherZh: "雪光 / 低风",
      weatherEn: "Snowlight / low wind",
      riskZh: "精力 -18",
      riskEn: "Energy -18",
      icon: "✦",
    },
  };
  const item = meta[scene];
  return {
    name: props.language === "en-US" ? item.en : item.zh,
    weather: props.language === "en-US" ? item.weatherEn : item.weatherZh,
    risk: props.language === "en-US" ? item.riskEn : item.riskZh,
    icon: item.icon,
  };
}

function dailyActionLimit(action: PetAction) {
  if (action === "quest") {
    return 1;
  }
  return 3;
}

function incrementDailyAction(action: PetAction) {
  if (action === "feed") {
    draft.pet.dailyFeedCount += 1;
  } else if (action === "pet") {
    draft.pet.dailyPetCount += 1;
  } else {
    draft.pet.dailyQuestCount += 1;
  }
}

function refreshDailyInteractions(pet: ApiPet) {
  const currentDay = todayKey();
  if (pet.dailyInteractionDate === currentDay) {
    return;
  }
  pet.dailyInteractionDate = currentDay;
  pet.dailyFeedCount = 0;
  pet.dailyPetCount = 0;
  pet.dailyQuestCount = 0;
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function settleLevelUps(pet: ApiPet) {
  let leveled = false;
  while (pet.experience >= levelRequirement(pet.level)) {
    pet.experience -= levelRequirement(pet.level);
    pet.level += 1;
    pet.mood = clampStat(pet.mood + 12);
    pet.energy = clampStat(pet.energy + 10);
    leveled = true;
  }
  return leveled;
}

function levelRequirement(level: number) {
  return 60 + (Math.max(1, level) - 1) * 28;
}

function clampStat(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function createId() {
  return `model-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function providerName(provider: ProviderFormat) {
  const names: Record<ProviderFormat, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini",
  };
  return names[provider];
}

function petSpeciesLabel(species: ApiPet["species"], appearance?: PixelPetAppearance) {
  return petAnimalLabel(appearance?.animal ?? speciesToAnimal(species));
}

function petAnimalLabel(animal: PixelPetAnimal) {
  const zh: Record<PixelPetAnimal, string> = {
    cat: "像素猫",
    dog: "像素犬",
    rabbit: "叶兔",
    panda: "熊猫",
    fox: "赤狐",
    bird: "云鸟",
    penguin: "企鹅",
    hamster: "仓鼠",
    turtle: "石龟",
  };
  const en: Record<PixelPetAnimal, string> = {
    cat: "Pixel Cat",
    dog: "Pixel Dog",
    rabbit: "Rabbit",
    panda: "Panda",
    fox: "Fox",
    bird: "Bird",
    penguin: "Penguin",
    hamster: "Hamster",
    turtle: "Turtle",
  };
  return props.language === "en-US" ? en[animal] : zh[animal];
}

function petPatternLabel(pattern: PixelPetPattern) {
  const zh: Record<PixelPetPattern, string> = {
    solid: "纯色",
    spots: "斑点",
    mask: "面罩",
    socks: "白袜",
    split: "拼色",
  };
  const en: Record<PixelPetPattern, string> = {
    solid: "Solid",
    spots: "Spots",
    mask: "Mask",
    socks: "Socks",
    split: "Split",
  };
  return props.language === "en-US" ? en[pattern] : zh[pattern];
}

function petExpressionLabel(expression: PixelPetExpression) {
  const zh: Record<PixelPetExpression, string> = {
    bright: "精神",
    happy: "开心",
    sleepy: "困倦",
    cool: "冷酷",
  };
  const en: Record<PixelPetExpression, string> = {
    bright: "Bright",
    happy: "Happy",
    sleepy: "Sleepy",
    cool: "Cool",
  };
  return props.language === "en-US" ? en[expression] : zh[expression];
}

function petAccessoryLabel(accessory: PixelPetAccessory) {
  const zh: Record<PixelPetAccessory, string> = {
    none: "无",
    scarf: "围巾",
    bell: "铃铛",
    leaf: "叶子",
    satchel: "小包",
  };
  const en: Record<PixelPetAccessory, string> = {
    none: "None",
    scarf: "Scarf",
    bell: "Bell",
    leaf: "Leaf",
    satchel: "Satchel",
  };
  return props.language === "en-US" ? en[accessory] : zh[accessory];
}

function petSprite(petOrSpecies: ApiPet | ApiPet["species"]) {
  const appearance = typeof petOrSpecies === "string"
    ? defaultPetAppearance(petOrSpecies)
    : normalizePetAppearance(petOrSpecies.appearance, petOrSpecies.species);
  return pixelPetDataUrl(appearance);
}

function pixelPetDataUrl(appearance: PixelPetAppearance) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(pixelPetSvg(appearance))}`;
}

function pixelPetSvg(appearance: PixelPetAppearance) {
  const base = appearance.primaryColor;
  const patch = appearance.secondaryColor;
  const accent = appearance.accentColor;
  const dark = "#262a28";
  const blush = "#e58a92";
  const light = "#fff7e3";
  const parts: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string, opacity = 1) => {
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" opacity="${opacity}"/>`);
  };
  const body = (x = 8, y = 13, w = 16, h = 13, color = base) => rect(x, y, w, h, color);
  const face = (x = 9, y = 8, w = 14, h = 12, color = base) => rect(x, y, w, h, color);
  const ear = (left: [number, number, number, number], right: [number, number, number, number], color = base) => {
    rect(...left, color);
    rect(...right, color);
  };

  rect(9, 25, 5, 2, dark, 0.22);
  rect(18, 25, 5, 2, dark, 0.22);

  if (appearance.animal === "rabbit") {
    ear([9, 2, 4, 8], [19, 2, 4, 8]);
    rect(10, 3, 2, 5, patch);
    rect(20, 3, 2, 5, patch);
    body(8, 14, 16, 12);
    face(9, 9, 14, 11);
    rect(23, 17, 3, 4, base);
  } else if (appearance.animal === "cat") {
    ear([8, 6, 5, 5], [19, 6, 5, 5]);
    rect(10, 8, 2, 2, patch);
    rect(20, 8, 2, 2, patch);
    body();
    face();
    rect(5, 16, 4, 3, base);
    rect(4, 15, 2, 2, base);
  } else if (appearance.animal === "dog") {
    rect(6, 8, 5, 8, patch);
    rect(21, 8, 5, 8, patch);
    body(8, 14, 16, 12);
    face(9, 8, 14, 12);
    rect(23, 17, 4, 3, base);
  } else if (appearance.animal === "panda") {
    ear([7, 7, 5, 5], [20, 7, 5, 5], patch);
    body(8, 14, 16, 12, patch);
    face(9, 8, 14, 12, base);
    rect(10, 11, 4, 5, patch);
    rect(18, 11, 4, 5, patch);
    rect(11, 20, 3, 5, base);
    rect(18, 20, 3, 5, base);
  } else if (appearance.animal === "fox") {
    ear([8, 5, 5, 6], [19, 5, 5, 6]);
    rect(10, 7, 2, 3, patch);
    rect(20, 7, 2, 3, patch);
    body(8, 14, 16, 12);
    face(9, 8, 14, 12);
    rect(12, 15, 8, 5, patch);
    rect(5, 16, 5, 4, base);
    rect(4, 18, 3, 3, patch);
  } else if (appearance.animal === "bird") {
    rect(11, 7, 10, 9, base);
    body(8, 13, 16, 13);
    rect(6, 15, 5, 7, patch);
    rect(21, 15, 5, 7, patch);
    rect(15, 12, 2, 3, accent);
    rect(13, 3, 6, 4, accent);
  } else if (appearance.animal === "penguin") {
    body(8, 9, 16, 17, base);
    rect(11, 10, 10, 13, patch);
    rect(6, 15, 3, 6, base);
    rect(23, 15, 3, 6, base);
    rect(13, 17, 6, 4, light);
    rect(14, 13, 4, 2, accent);
  } else if (appearance.animal === "hamster") {
    ear([7, 8, 5, 5], [20, 8, 5, 5], patch);
    body(8, 14, 16, 12);
    face(9, 9, 14, 11);
    rect(10, 16, 4, 4, patch);
    rect(18, 16, 4, 4, patch);
  } else {
    body(8, 14, 16, 11, patch);
    rect(6, 16, 20, 7, base);
    rect(10, 9, 12, 8, base);
    rect(8, 21, 3, 4, patch);
    rect(21, 21, 3, 4, patch);
  }

  if (appearance.pattern === "spots") {
    rect(11, 14, 3, 3, patch);
    rect(19, 17, 3, 3, patch);
    rect(14, 22, 3, 2, patch);
  } else if (appearance.pattern === "mask") {
    rect(10, 11, 4, 4, patch);
    rect(18, 11, 4, 4, patch);
  } else if (appearance.pattern === "socks") {
    rect(9, 22, 4, 4, patch);
    rect(19, 22, 4, 4, patch);
  } else if (appearance.pattern === "split") {
    rect(16, 8, 7, 12, patch);
    rect(16, 14, 8, 12, patch);
  }

  drawFace(appearance.expression, rect, dark, blush, accent);
  if (appearance.accessory === "scarf") {
    rect(9, 19, 14, 2, accent);
    rect(19, 21, 3, 4, accent);
  } else if (appearance.accessory === "bell") {
    rect(15, 20, 2, 2, accent);
    rect(14, 19, 4, 1, dark, 0.55);
  } else if (appearance.accessory === "leaf") {
    rect(17, 5, 4, 2, accent);
    rect(19, 4, 2, 4, accent);
  } else if (appearance.accessory === "satchel") {
    rect(20, 18, 5, 5, "#7d5b44");
    rect(21, 18, 3, 1, accent);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" fill="none"/>${parts.join("")}</svg>`;
}

function drawFace(
  expression: PixelPetExpression,
  rect: (x: number, y: number, w: number, h: number, color: string, opacity?: number) => void,
  dark: string,
  blush: string,
  accent: string,
) {
  if (expression === "sleepy") {
    rect(11, 14, 4, 1, dark);
    rect(18, 14, 4, 1, dark);
    rect(15, 17, 3, 1, dark);
  } else if (expression === "cool") {
    rect(10, 13, 5, 2, dark);
    rect(18, 13, 5, 2, dark);
    rect(15, 14, 3, 1, dark);
    rect(14, 18, 4, 1, dark);
  } else {
    rect(12, 13, 2, 2, dark);
    rect(19, 13, 2, 2, dark);
    rect(15, 16, 2, 1, dark);
    if (expression === "happy") {
      rect(14, 18, 1, 1, dark);
      rect(15, 19, 3, 1, dark);
      rect(18, 18, 1, 1, dark);
    } else {
      rect(15, 18, 3, 1, dark);
    }
  }
  rect(9, 16, 2, 1, blush, 0.72);
  rect(21, 16, 2, 1, blush, 0.72);
  rect(23, 10, 2, 2, accent, 0.82);
}
</script>
