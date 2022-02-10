export default class ModeData {
    constructor(mode_name = undefined, mode_description = undefined, mode_image = undefined, mode_entryCode = undefined, mode_groupCode = undefined, mode_participants) {
        this.name = mode_name
        this.description = mode_description
        this.image = mode_image
        this.entryCode = mode_entryCode
        this.groupCode = mode_groupCode
        this.participants = mode_participants
    }
    static createFromElement(element) {
        return new ModeData(
            element.mode_name,
            element.mode_description,
            element.mode_image,
            element.mode_entryCode === -1,
            element.mode_groupCode,
            element.mode_participants
        )
    }
}