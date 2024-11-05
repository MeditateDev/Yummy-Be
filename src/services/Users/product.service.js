const db = require("../../models/index.model");
const Products = db.Product;
const Categories = db.Categories;
const Topping = db.Topping;
const RedisHelper = require("../../caches/redis");
const {
  updateProductById,
  publishedProductByRestaurant,
  draftProductByRestaurant,
  findAllDraftsForShop,
  findAllProduct,
  findProduct,
  findProductByUser,
  findAllPublicForShop,
  getProductByRestaurantId,
} = require("./repositories/product.repo");

class Product {
  constructor({
    name,
    image,
    descriptions,
    price,
    quantity,
    is_available,
    restaurant_id,
  }) {
    this.name = name;
    this.image = image;
    this.descriptions = descriptions;
    this.price = price;
    this.quantity = quantity;
    this.is_available = is_available;
    this.restaurant_id = restaurant_id;
  }

  async createProduct() {
    return await Products.create({ ...this });
  }

  async updateProduct(productId, bodyUpdate) {
    return await updateProductById({
      productId,
      bodyUpdate,
      model: Products,
    });
  }
}

class ProductService extends Product {
  static async initRedis() {
    const redis = new RedisHelper({ keyPrefix: 'product:' });
    await redis.connect();
    return redis;
  }
  static createProduct = async (categoriesId, toppingData, productData) => {
    if (!productData) {
      throw new Error("Payload is required to create a product");
    }

    const { name, image, descriptions, price, quantity, is_available } =
      productData.productData;
    const newProductInstance = new Product({
      name,
      image,
      descriptions,
      price,
      quantity,
      is_available,
      restaurant_id: productData.user_id,
    });

    const newProduct = await newProductInstance.createProduct();

    if (categoriesId) {
      const categories = await Categories.findAll({
        where: {
          id: categoriesId,
        },
      });
      await newProduct.addCategories(categories);
    }

    if (toppingData) {
      const toppings = await Promise.all(
        toppingData.map(async (data) => await Topping.create(data))
      );
      await newProduct.addToppings(toppings);
    }

    return newProduct;
  };

  static updateProduct = async (
    product_id,
    categoriesId,
    toppingData,
    payload
  ) => {
    const { name, image, descriptions, price, quantity, is_available } =
      payload.productData;
    const updateProductInstance = new Product({
      name,
      image,
      descriptions,
      price,
      quantity,
      is_available,
    });
    await updateProductInstance.updateProduct(product_id, {
      name,
      image,
      descriptions,
      price,
      quantity,
      is_available,
    });

    if (categoriesId) {
      const categories = await Categories.findAll({
        where: {
          id: categoriesId,
        },
      });
      const product = await Products.findByPk(product_id);
      await product.setCategories(categories);
    }
    if (toppingData && toppingData.length > 0) {
      const product = await Products.findByPk(product_id, {
        include: [
          {
            model: Topping,
            attributes: ["id"],
          },
        ],
      });

      const currentToppings = product.Toppings;
      await Promise.all(
        toppingData.map(async (data, index) => {
          const currentTopping = currentToppings[index];
          if (currentTopping) {
            await Topping.update(
              {
                topping_name: data.topping_name,
                price: data.price,
                is_available: data.is_available,
              },
              {
                where: { id: currentTopping.dataValues.id },
              }
            );
          }
        })
      );
    }

    return await Products.findByPk(product_id);
  };

  static async publishedProductByRestaurant({
    product_id,
    product_restaurant,
  }) {
    return publishedProductByRestaurant({ product_id, product_restaurant });
  }
  static async draftProductByRestaurant({ product_id, product_restaurant }) {
    return draftProductByRestaurant({ product_id, product_restaurant });
  }

  static async findAllDraftsForRestaurant({
    product_restaurant,
    limit = 60,
    skip = 0,
  }) {
    const query = {
      restaurant_id: product_restaurant,
      is_draft: true,
    };
    return await findAllDraftsForShop({ query, limit, skip });
  }

  static async findAllPublicForRestaurant({
    product_restaurant,
    limit = 60,
    skip = 0,
  }) {
    const query = {
      restaurant_id: product_restaurant,
      is_public: true,
    };
    return await findAllPublicForShop({ query, limit, skip });
  }
  static async getListSearchProduct(keySearch) {
    return await findProductByUser(keySearch);
  }
  static async findAllProduct({
    limit = 30,
    sort = "ctime",
    page = 1,
    filter = { is_public: true },
  }) {
    return await findAllProduct({
      limit,
      sort,
      page,
      filter,
      select: ["name", "image", "price", "restaurant_id"],
    });
  }
  static async findProduct({ product_id }) {
    return await findProduct({ product_id, unSelect: ["__v"] });
  }
  static async getListProductForRes({ restaurant_id }) {
    return await getProductByRestaurantId({ restaurant_id });
  }
  static async getListProductForUser({ restaurant_id }) {
    const redisKey = `restaurant_id:${restaurant_id}:products`;
    const redis = await ProductService.initRedis();
  
    const cacheData = await redis.get(redisKey);
    if (cacheData) {
      return JSON.parse(cacheData); 
    } else {
      const result = await getProductByRestaurantId({ restaurant_id });
      
      await redis.set(redisKey, JSON.stringify(result), this.redisKeyTTL);
      
      return result;
    }
  }
  
}

module.exports = ProductService;
