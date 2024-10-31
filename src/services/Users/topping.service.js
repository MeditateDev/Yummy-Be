const db = require("../../models/index.model");
const Topping = db.Topping;
const { BadRequestError } = require("../../core/error.response");
class ToppingService {

  static updateTopping = async (toppingId, payload) => {
    const [updated] = await Topping.update(payload, {
      where: { id: toppingId },
    });
    if (updated) {
      const updateTopping = await Topping.findOne({ where: { id: toppingId } });
      return updateTopping;
    }
    return new BadRequestError(`update failed`);
  };

  static getToppingByProduct = async (product_id) =>{
    return await db.Product.findOne({
      where:{id:product_id},
      include:{
        model: Topping,
        through: {attribute: []},
      }
    })
  }
}

module.exports = ToppingService;
